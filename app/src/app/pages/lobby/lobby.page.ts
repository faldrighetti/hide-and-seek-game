import { Component, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, combineLatest, Observable } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { GameFacadeService } from '../../services/game-facade';
import { FirebaseGameClientService } from '../../services/firebase-game-client.service';
import { GameBlueprint, LobbyState, PlayerRole, Seat } from '../../models/core-model';

interface TeamGroup {
  id: string;
  members: Seat[];
  requiredSeats: number;
  isComplete: boolean;
}

interface LobbyViewModel {
  lobby: LobbyState;
  role: PlayerRole;
  teams: TeamGroup[];
  expectedSeats: number;
  missingSeats: number;
  allSeatsAssigned: boolean;
  hasCompleteTeams: boolean;
  canStart: boolean;
  startBlockedReason: string;
}

@Component({
  selector: 'app-lobby',
  templateUrl: './lobby.page.html',
  styleUrls: ['./lobby.page.scss'],
  standalone: false,
})
export class LobbyPage implements OnDestroy {
  private static readonly ADMIN_HOST_EMAIL = 'fede.aldrighetti.15@gmail.com';
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gameFacade = inject(GameFacadeService);
  private readonly firebaseClient = inject(FirebaseGameClientService);
  private readonly destroy$ = new Subject<void>();

  readonly gameId = this.route.snapshot.paramMap.get('gameId') ?? '';
  copiedMessage = '';
  starting = false;
  assigningSeatId: string | null = null;
  randomizing = false;
  updatingUkMode = false;
  updatingPhaseDurations = false;
  isAdminUser = false;
  intermissionMinutes = 2;
  escapeMinutes = 2;
  chaseMinutes = 300;
  phaseDurationsSavedMessage = '';
  errorMessage = '';
  private phaseDurationsInitialized = false;
  readonly lobby$: Observable<LobbyState | null> = this.gameFacade.lobby$.pipe(
    map(lobby => (lobby?.gameId === this.gameId ? lobby : null)),
  );

  readonly vm$: Observable<LobbyViewModel | null> = combineLatest([
    this.lobby$,
    this.gameFacade.blueprint$,
    this.gameFacade.playerRole$,
    ]).pipe(
    map(([lobby, blueprint, role]) => {
      if (!lobby) {
        return null;
      }

      const expectedSeats = this.expectedSeats(blueprint);
      const missingSeats = Math.max(0, expectedSeats - lobby.seats.length);
      const teams = this.buildTeamGroups(lobby, blueprint);
      const unassignedSeats = lobby.seats.filter(seat => !seat.teamId);
      const allSeatsAssigned = missingSeats === 0 && unassignedSeats.length === 0;
      const hasCompleteTeams = teams.every(team => team.isComplete);
      const startBlockedReason = this.startBlockedReason(missingSeats, unassignedSeats.length, hasCompleteTeams);
      const canStart = startBlockedReason.length === 0;

      return {
        lobby,
        role,
        teams,
        expectedSeats,
        missingSeats,
        allSeatsAssigned,
        hasCompleteTeams,
        canStart,
        startBlockedReason,
      };
    }),
  );

  constructor() {
    this.gameFacade.loadGame(this.gameId);
    this.firebaseClient.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.isAdminUser = user?.email?.trim().toLowerCase() === LobbyPage.ADMIN_HOST_EMAIL;
    });
    this.lobby$.pipe(
      filter((lobby): lobby is LobbyState => lobby !== null),
      takeUntil(this.destroy$),
    ).subscribe(lobby => {
      if (this.phaseDurationsInitialized) return;
      this.intermissionMinutes = Math.max(1, Math.round(lobby.settings.intermissionSeconds / 60));
      this.escapeMinutes = Math.max(1, Math.round(lobby.settings.escapeSeconds / 60));
      this.chaseMinutes = Math.max(1, Math.round(lobby.settings.chaseMaxSeconds / 60));
      this.phaseDurationsInitialized = true;
    });
    this.lobby$.pipe(
      filter((lobby): lobby is LobbyState => lobby?.status === 'LIVE'),
      takeUntil(this.destroy$),
    ).subscribe(() => this.router.navigate(['/game', this.gameId]));
  }

  async copyToClipboard(value: string, label: 'gameId' | 'link'): Promise<void> {
    this.errorMessage = '';
    this.copiedMessage = '';
    try {
      await navigator.clipboard.writeText(value);
      this.copiedMessage = label === 'gameId' ? 'gameId copiado.' : 'Link copiado.';
    } catch (error) {
      this.errorMessage = 'No se pudo copiar al portapapeles.';
    }
  }

  async shareInvitation(lobby: LobbyState): Promise<void> {
    this.errorMessage = '';
    this.copiedMessage = '';
    const text = `Sumate a mi partida de Hide & Seek. Código: ${lobby.gameId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Hide & Seek', text, url: lobby.joinLink });
        this.copiedMessage = 'Invitación compartida.';
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${lobby.joinLink}`);
      this.copiedMessage = 'Invitación copiada.';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.errorMessage = 'No se pudo compartir la invitación.';
    }
  }

  shareOnWhatsApp(lobby: LobbyState): void {
    const text = `Sumate a mi partida de Hide & Seek. Código: ${lobby.gameId}\n${lobby.joinLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async assignSeatToTeam(seatId: string, teamId: string, isHost: boolean): Promise<void> {
    if (!isHost) {
      return;
    }

    this.assigningSeatId = seatId;
    this.errorMessage = '';
    try {
      await this.gameFacade.assignSeatToTeam(this.gameId, seatId, teamId);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo asignar el equipo.';
    } finally {
      this.assigningSeatId = null;
    }
  }

  retryLoad(): void {
    this.errorMessage = '';
    this.gameFacade.loadGame(this.gameId, true);
  }

  async randomizeTeams(isHost: boolean): Promise<void> {
    if (!isHost) {
      return;
    }

    this.randomizing = true;
    this.errorMessage = '';
    try {
      await this.gameFacade.randomizeTeams(this.gameId);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo asignar al azar.';
    } finally {
      this.randomizing = false;
    }
  }

  async setUkMode(enabled: boolean, isHost: boolean): Promise<void> {
    if (!isHost) {
      return;
    }

    this.updatingUkMode = true;
    this.errorMessage = '';
    try {
      await this.gameFacade.setUkMode(this.gameId, enabled);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo actualizar “Omitir turno del líder”.';
    } finally {
      this.updatingUkMode = false;
    }
  }

  phaseDurationsValid(): boolean {
    return [this.intermissionMinutes, this.escapeMinutes, this.chaseMinutes]
      .every(value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1440);
  }

  async savePhaseDurations(isHost: boolean): Promise<void> {
    if (!isHost || !this.isAdminUser || !this.phaseDurationsValid()) return;

    this.updatingPhaseDurations = true;
    this.phaseDurationsSavedMessage = '';
    this.errorMessage = '';
    try {
      await this.gameFacade.setPhaseDurations(
        this.gameId,
        Number(this.intermissionMinutes),
        Number(this.escapeMinutes),
        Number(this.chaseMinutes),
      );
      this.phaseDurationsSavedMessage = 'Duraciones guardadas para esta partida.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudieron guardar las duraciones.';
    } finally {
      this.updatingPhaseDurations = false;
    }
  }

  async startGame(isHost: boolean): Promise<void> {
    if (!isHost) {
      return;
    }

    this.starting = true;
    this.errorMessage = '';
    try {
      await this.gameFacade.startGame(this.gameId);
      this.router.navigate(['/game', this.gameId]);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo iniciar la partida.';
    } finally {
      this.starting = false;
    }
  }

  private buildTeamGroups(lobby: LobbyState, blueprint: GameBlueprint): TeamGroup[] {
    const teamIds = blueprint.standings
      .map(team => team.id)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const requiredSeats = Math.max(1, Math.floor(this.expectedSeats(blueprint) / teamIds.length));

    return teamIds.map(teamId => {
      const members = lobby.seats
        .filter(seat => seat.teamId === teamId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      return {
        id: teamId,
        members,
        requiredSeats,
        isComplete: members.length === requiredSeats,
      };
    });
  }

  private expectedSeats(blueprint: GameBlueprint): number {
    if (blueprint.mode === 'INDIVIDUAL_1v1') return 2;
    if (blueprint.mode === 'INDIVIDUAL_3') return 3;
    if (blueprint.mode === 'TEAMS_2v2') return 4;
    return 6;
  }

  private startBlockedReason(missingSeats: number, unassignedSeats: number, hasCompleteTeams: boolean): string {
    if (missingSeats > 0) {
      return missingSeats === 1 ? 'Falta 1 jugador para completar la partida.' : `Faltan ${missingSeats} jugadores para completar la partida.`;
    }

    if (unassignedSeats > 0) {
      return 'Todos los jugadores tienen que tener equipo.';
    }

    if (!hasCompleteTeams) {
      return 'Los equipos tienen que quedar completos y equilibrados.';
    }

    return '';
  }
}
