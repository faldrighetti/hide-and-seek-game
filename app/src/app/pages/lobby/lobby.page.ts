import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GameFacadeService } from '../../services/game-facade';
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
export class LobbyPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gameFacade = inject(GameFacadeService);

  readonly gameId = this.route.snapshot.paramMap.get('gameId') ?? '';
  starting = false;
  assigningSeatId: string | null = null;
  randomizing = false;
  locking = false;
  errorMessage = '';
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

      const teams = this.buildTeamGroups(lobby, blueprint);
      const unassignedSeats = lobby.seats.filter(seat => !seat.teamId);
      const emptyTeams = teams.filter(team => team.members.length === 0);
      const hasCompleteTeams = teams.every(team => team.isComplete);
      const startBlockedReason = this.startBlockedReason(unassignedSeats.length, emptyTeams);
      const canStart = startBlockedReason.length === 0;

      return { lobby, role, teams, hasCompleteTeams, canStart, startBlockedReason };
    }),
  );

  constructor() {
    this.gameFacade.loadGame(this.gameId);
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

  async toggleLock(isHost: boolean): Promise<void> {
    if (!isHost) {
      return;
    }

    this.locking = true;
    this.errorMessage = '';
    try {
      await this.gameFacade.toggleTeamsLock(this.gameId);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo cambiar el bloqueo de equipos.';
    } finally {
      this.locking = false;
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

    const requiredSeats = Math.max(1, Math.floor(lobby.seats.length / teamIds.length));

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

  private startBlockedReason(unassignedSeats: number, emptyTeams: TeamGroup[]): string {
    if (unassignedSeats > 0) {
      return 'Todos los jugadores tienen que tener equipo.';
    }

    if (emptyTeams.length > 0) {
      return `Faltan jugadores en equipo ${emptyTeams.map(team => team.id).join(', ')}.`;
    }

    return '';
  }
}
