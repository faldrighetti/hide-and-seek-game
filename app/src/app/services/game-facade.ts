import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { auth, db } from './firebase';
import {
  DEFAULT_SETTINGS,
  GameBlueprint,
  GameMode,
  LobbyState,
  Seat,
  TeamStanding,
  WinCondition,
} from '../models/core-model';

/** -------------------------
 *  Local blueprint helpers (igual que tu versión anterior)
 *  ------------------------- */

const createSeedStandings = (mode: GameMode): TeamStanding[] => {
  if (mode === 'TEAMS_2v2') {
    return [
      { id: 'A', name: 'Team A', totalTimeSeconds: 0, bestSingleRunSeconds: 0, runsCompleted: 0 },
      { id: 'B', name: 'Team B', totalTimeSeconds: 0, bestSingleRunSeconds: 0, runsCompleted: 0 },
    ];
  }

  return [
    {
      id: 'A',
      name: mode === 'INDIVIDUAL_3' ? 'Player A' : 'Team A',
      totalTimeSeconds: 0,
      bestSingleRunSeconds: 0,
      runsCompleted: 0,
    },
    {
      id: 'B',
      name: mode === 'INDIVIDUAL_3' ? 'Player B' : 'Team B',
      totalTimeSeconds: 0,
      bestSingleRunSeconds: 0,
      runsCompleted: 0,
    },
    {
      id: 'C',
      name: mode === 'INDIVIDUAL_3' ? 'Player C' : 'Team C',
      totalTimeSeconds: 0,
      bestSingleRunSeconds: 0,
      runsCompleted: 0,
    },
  ];
};

const buildBlueprint = (
  mode: GameMode,
  turnsPerTeam: 1 | 2 | 3,
  winCondition: WinCondition,
  ukMode = false,
): GameBlueprint => {
  const settings = { ...DEFAULT_SETTINGS, turnsPerTeam, winCondition, ukMode };

  return {
    gameName: 'Jet Lag Hide & Seek AMBA',
    mode,
    settings,
    currentTurn: {
      runNumber: 1,
      hiderTeamId: 'A',
      phase: 'INTERMISSION',
      endsAtIso: new Date(Date.now() + settings.intermissionSeconds * 1000).toISOString(),
      pendingQuestion: false,
      expirations: 0,
      foundVotes: [],
      endgameEligible: false,
      endgameActive: false,
    },
    standings: createSeedStandings(mode),
    questionPolicy: {
      maxPendingQuestions: 1,
      photoTimeoutSeconds: 600,
      regularTimeoutSeconds: 300,
      timeoutPenaltySeconds: 1800,
    },
    deckPolicy: {
      maxSize: settings.deckMaxSize,
      reshuffleEnabled: true,
      duplicateReplacesItself: true,
    },
    effectPolicy: {
      allowOnlyInChaseOrEndgame: true,
      blockIfQuestionPending: true,
      uniqueByEffectType: true,
      serverDice: true,
    },
    endgamePolicy: {
      eligibleRadiusM: settings.zoneRadiusM + settings.eligibleBufferM,
      requestCooldownSeconds: settings.endgameRequestCooldownSeconds,
      canRequestAnytimeDuringChase: true,
      tentaclesOnlyInEndgame: true,
    },
  };
};

const GAME_ID_LENGTH = 6;
const randomGameId = (): string =>
  Math.random().toString(36).slice(2, 2 + GAME_ID_LENGTH).toUpperCase();

/** -------------------------
 *  GameFacadeService
 *  ------------------------- */

@Injectable({ providedIn: 'root' })
export class GameFacadeService {
  /** Blueprint sigue siendo local por ahora (para que game.page.ts no explote) */
  private readonly blueprintSubject = new BehaviorSubject<GameBlueprint>(
    buildBlueprint('INDIVIDUAL_3', 2, 'TOTAL_TIME'),
  );
  readonly blueprint$ = this.blueprintSubject.asObservable();

  /** Lobby viene de Firestore */
  private readonly lobbySubject = new BehaviorSubject<LobbyState | null>(null);
  readonly lobby$ = this.lobbySubject.asObservable();

  /** Unsubscribers de snapshots */
  private gameUnsub: (() => void) | null = null;
  private seatsUnsub: (() => void) | null = null;

  constructor() {
    // Mantener sesión anónima viva si todavía no existe
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.error('Anonymous sign-in failed', e);
        }
      }
    });
  }

  /** Asegura uid antes de cualquier operación */
  private async requireUid(): Promise<string> {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    return auth.currentUser!.uid;
  }

  /** -------------------------
   *  Firestore lobby operations
   *  ------------------------- */

  /**
   * Crea un juego en Firestore y agrega el seat del host.
   * Devuelve LobbyState (compat con tu UI).
   */
  async createGame(
    mode: GameMode,
    turnsPerTeam: 1 | 2 | 3,
    winCondition: WinCondition,
    ukMode: boolean,
    hostDisplayName: string,
  ): Promise<LobbyState> {
    const uid = await this.requireUid();
    const normalizedHostName = hostDisplayName.trim() || 'Host';

    // blueprint local (por ahora)
    const blueprint = buildBlueprint(mode, turnsPerTeam, winCondition, ukMode);
    this.blueprintSubject.next(blueprint);

    let gameId = randomGameId();

    // Crear doc game y seat en una transacción para evitar colisiones simples
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await runTransaction(db, async (tx) => {
          const gameRef = doc(db, 'games', gameId);
          const gameSnap = await tx.get(gameRef);
          if (gameSnap.exists()) throw new Error('collision');

          tx.set(gameRef, {
            gameId,
            mode,
            turnsPerTeam,
            winCondition,
            ukMode,
            status: 'LOBBY',
            hostUid: uid,
            teamsLocked: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const seatRef = doc(db, 'games', gameId, 'seats', uid);
          tx.set(seatRef, {
            uid,
            displayName: normalizedHostName,
            displayNameLower: normalizedHostName.toLowerCase(),
            teamId: 'A',
            isHost: true,
            joinedAt: serverTimestamp(),
          });
        });
        break;
      } catch (e: any) {
        if (String(e?.message).includes('collision')) {
          gameId = randomGameId();
          continue;
        }
        throw e;
      }
    }

    // Comenzar a escuchar el lobby en vivo
    this.loadGame(gameId);

    // Devolver lobby inicial (la verdad final vendrá del snapshot)
    const lobby: LobbyState = {
      gameId,
      joinLink: `${window.location.origin}/join/${gameId}`,
      seats: [{ id: `seat-${uid}`, displayName: normalizedHostName, teamId: 'A', host: true }],
      teamsLocked: false,
    };
    this.lobbySubject.next(lobby);
    return lobby;
  }

  /**
   * Une al usuario (uid) a seats/{uid}.
   * No navega: la page debe await y luego navegar.
   */
  async joinGame(gameIdRaw: string, displayName: string): Promise<void> {
    const uid = await this.requireUid();
    const gameId = gameIdRaw.trim().toUpperCase();
    const normalizedName = displayName.trim();

    if (!gameId || !normalizedName) return;

    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) {
      throw new Error('not-found');
    }

    // Escribir seat propio
    const seatRef = doc(db, 'games', gameId, 'seats', uid);
    await setDoc(
      seatRef,
      {
        uid,
        displayName: normalizedName,
        displayNameLower: normalizedName.toLowerCase(),
        teamId: 'A', // luego podés asignar según mode/standings
        isHost: false,
        joinedAt: serverTimestamp(),
      },
      { merge: true },
    );

    // Escuchar lobby
    this.loadGame(gameId);
  }

  /**
   * Suscribe a /games/{gameId} y /games/{gameId}/seats en tiempo real
   */
  loadGame(gameIdRaw: string): void {
    const gameId = (gameIdRaw ?? '').trim().toUpperCase();
    if (!gameId) return;

    this.gameUnsub?.();
    this.seatsUnsub?.();
    this.gameUnsub = this.seatsUnsub = null;

    const gameRef = doc(db, 'games', gameId);
    const seatsRef = collection(db, 'games', gameId, 'seats');

    let gameData: any = null;
    let seats: Seat[] = [];

    this.gameUnsub = onSnapshot(
      gameRef,
      (snap) => {
        gameData = snap.exists() ? snap.data() : null;
        this.emitLobby(gameId, gameData, seats);
      },
      (err) => {
        console.error('game snapshot error', err);
        // si no hay permiso / no existe, mostramos null
        this.lobbySubject.next(null);
      },
    );

    this.seatsUnsub = onSnapshot(
      seatsRef,
      (snap) => {
        seats = snap.docs.map((d) => {
          const s: any = d.data();
          return {
            id: `seat-${d.id}`,
            displayName: s.displayName,
            teamId: s.teamId ?? 'A',
            host: !!s.isHost,
          } as Seat;
        });
        this.emitLobby(gameId, gameData, seats);
      },
      (err) => {
        console.error('seats snapshot error', err);
        // con reglas Estrategia A, esto puede fallar si aún no sos miembro
        // Podés ignorarlo; en cuanto hagas join, va a empezar a funcionar.
      },
    );
  }

  private emitLobby(gameId: string, gameData: any, seats: Seat[]): void {
    if (!gameData) {
      this.lobbySubject.next(null);
      return;
    }

    const lobby: LobbyState = {
      gameId,
      joinLink: `${window.location.origin}/join/${gameId}`,
      seats,
      teamsLocked: !!gameData.teamsLocked,
    };

    this.lobbySubject.next(lobby);
  }

  /** -------------------------
   *  Lobby actions (host-only idealmente)
   *  ------------------------- */

  async toggleTeamsLock(gameIdRaw: string): Promise<void> {
    const uid = await this.requireUid();
    const gameId = gameIdRaw.trim().toUpperCase();
    if (!gameId) return;

    const gameRef = doc(db, 'games', gameId);
    // Requiere rules: allow update solo host (Estrategia A)
    // No validamos host en cliente; rules lo aplican.
    const snap = await getDoc(gameRef);
    if (!snap.exists()) return;
    const current = snap.data() as any;
    await updateDoc(gameRef, {
      teamsLocked: !current.teamsLocked,
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * Randomize teams: para mantenerlo simple en MVP, lo dejamos local/no-op o
   * lo implementás como host actualizando cada seat.
   * (Recomendación: hacerlo host-only y con reglas)
   */
  async randomizeTeams(gameIdRaw: string): Promise<void> {
    const gameId = gameIdRaw.trim().toUpperCase();
    if (!gameId) return;

    const lobby = this.lobbySubject.value;
    if (!lobby || lobby.teamsLocked) return;

    // Esto reescribe teamId en Firestore (host-only según rules)
    const teams = this.blueprintSubject.value.standings.map((t) => t.id);
    const shuffled = [...lobby.seats].sort(() => Math.random() - 0.5);

    // Nota: muchas escrituras; OK para MVP con pocos jugadores.
    await Promise.all(
      shuffled.map((seat, index) => {
        const uid = seat.id.replace(/^seat-/, '');
        const seatRef = doc(db, 'games', gameId, 'seats', uid);
        return updateDoc(seatRef, {
          teamId: teams[index % teams.length],
        });
      }),
    );

    await updateDoc(doc(db, 'games', gameId), { updatedAt: serverTimestamp() });
  }

  /** -------------------------
   *  Blueprint / Game logic (local, compat con GamePage)
   *  ------------------------- */

  configure(mode: GameMode, turnsPerTeam: 1 | 2 | 3, winCondition: WinCondition): void {
    this.blueprintSubject.next(buildBlueprint(mode, turnsPerTeam, winCondition));
  }

  setPhase(phase: GameBlueprint['currentTurn']['phase']): void {
    const current = this.blueprintSubject.value;
    const durationByPhase = {
      INTERMISSION: current.settings.intermissionSeconds,
      ESCAPE: current.settings.escapeSeconds,
      CHASE: current.settings.chaseMaxSeconds,
      ENDED: 0,
    } as const;

    this.blueprintSubject.next({
      ...current,
      currentTurn: {
        ...current.currentTurn,
        phase,
        endsAtIso: new Date(Date.now() + durationByPhase[phase] * 1000).toISOString(),
      },
    });
  }

  voteFound(teamId: string): void {
    const current = this.blueprintSubject.value;
    const votes = current.currentTurn.foundVotes.includes(teamId)
      ? current.currentTurn.foundVotes
      : [...current.currentTurn.foundVotes, teamId];

    this.blueprintSubject.next({
      ...current,
      currentTurn: {
        ...current.currentTurn,
        foundVotes: votes,
      },
    });
  }
}