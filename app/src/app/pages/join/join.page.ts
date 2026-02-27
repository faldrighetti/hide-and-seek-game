import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GameFacadeService } from '../../services/game-facade';

@Component({
  selector: 'app-join',
  templateUrl: './join.page.html',
  styleUrls: ['./join.page.scss'],
  standalone: false,
})
export class JoinPage {
  private readonly gameFacade = inject(GameFacadeService);
  private readonly router = inject(Router);

  gameId = '';
  displayName = '';

  join(): void {
    const normalizedGameId = this.gameId.trim().toUpperCase();
    if (!normalizedGameId) {
      return;
    }

    this.gameFacade.joinGame(normalizedGameId, this.displayName);
    this.router.navigate(['/lobby', normalizedGameId]);
  }
}