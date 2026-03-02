import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GameFacadeService } from '../../services/game-facade';
import { GameMode, LobbyState, WinCondition } from '../../models/core-model';

@Component({
  selector: 'app-create',
  templateUrl: './create.page.html',
  styleUrls: ['./create.page.scss'],
  standalone: false,
})
export class CreatePage {
  private readonly gameFacade = inject(GameFacadeService);
  private readonly router = inject(Router);

  mode: GameMode = 'INDIVIDUAL_3';
  turnsPerTeam: 1 | 2 | 3 = 2;
  winCondition: WinCondition = 'TOTAL_TIME';
  ukMode = false;
  hostDisplayName = '';

  createdLobby: LobbyState | null = null;

  async create(): Promise<void> {
    this.createdLobby = await this.gameFacade.createGame(
      this.mode,
      this.turnsPerTeam,
      this.winCondition,
      this.ukMode,
      this.hostDisplayName,
    );
    this.router.navigate(['/lobby', this.createdLobby.gameId]);
  }

  goToLobby(): void {
    if (!this.createdLobby) {
      return;
    }
    this.router.navigate(['/lobby', this.createdLobby.gameId]);
  }
}