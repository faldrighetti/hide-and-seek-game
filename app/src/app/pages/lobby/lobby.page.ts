import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GameFacadeService } from '../../services/game-facade';
import { GameBlueprint, LobbyState, Seat } from '../../models/core-model';

interface TeamGroup {
  id: string;
  members: Seat[];
  requiredSeats: number;
  isComplete: boolean;
}

interface LobbyViewModel {
  lobby: LobbyState;
  teams: TeamGroup[];
  hasCompleteTeams: boolean;
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
  readonly lobby$: Observable<LobbyState | null> = this.gameFacade.lobby$.pipe(
    map(lobby => (lobby?.gameId === this.gameId ? lobby : null)),
  );

  readonly vm$: Observable<LobbyViewModel | null> = combineLatest([
    this.lobby$,
    this.gameFacade.blueprint$,
    ]).pipe(
    map(([lobby, blueprint]) => {
      if (!lobby) {
        return null;
      }

      const teams = this.buildTeamGroups(lobby, blueprint);
      const hasCompleteTeams = teams.every(team => team.isComplete);

      return { lobby, teams, hasCompleteTeams };
    }),
  );

  constructor() {
    this.gameFacade.loadGame(this.gameId);
  }

  assignSeatToTeam(seatId: string, teamId: string): void {
    this.gameFacade.assignSeatToTeam(this.gameId, seatId, teamId);
  }

  randomizeTeams(): void {
    this.gameFacade.randomizeTeams(this.gameId);
  }

  toggleLock(): void {
    this.gameFacade.toggleTeamsLock(this.gameId);
  }

  startGame(): void {
    this.router.navigate(['/game', this.gameId]);
  }

  private buildTeamGroups(lobby: LobbyState, blueprint: GameBlueprint): TeamGroup[] {
    const teamIds = blueprint.standings
      .map(team => team.id)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const requiredSeats = Math.floor(lobby.seats.length / teamIds.length);

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
}