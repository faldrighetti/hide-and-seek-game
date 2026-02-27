import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GameFacadeService } from '../game-facade';
import { LobbyState } from '../core-model';

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