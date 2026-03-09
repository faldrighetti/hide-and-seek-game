import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GameFacadeService } from '../../services/game-facade';
import { LobbyState, Seat } from '../../models/core-model';

interface TeamGroup {
  id: string;
  members: Seat[];
}

interface LobbyViewModel {
  lobby: LobbyState;
  teams: TeamGroup[];
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

    readonly vm$: Observable<LobbyViewModel | null> = this.lobby$.pipe(
    map(lobby => {
      if (!lobby) {
        return null;
      }

      const teamsMap = new Map<string, Seat[]>();
      for (const seat of lobby.seats) {
        const members = teamsMap.get(seat.teamId) ?? [];
        members.push(seat);
        teamsMap.set(seat.teamId, members);
      }

      const teams = Array.from(teamsMap.entries())
        .map(([id, members]) => ({
          id,
          members: [...members].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        }))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

      return { lobby, teams };
    }),
  );

  constructor() {
    this.gameFacade.loadGame(this.gameId);
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
}