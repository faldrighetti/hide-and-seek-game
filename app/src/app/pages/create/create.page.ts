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
  hostDisplayName = '';
  creating = false;
  errorMessage = '';

  createdLobby: LobbyState | null = null;

  onTurnsPerTeamChange(turnsPerTeam: 1 | 2 | 3): void {
    this.turnsPerTeam = turnsPerTeam;
    if (turnsPerTeam === 1) {
      this.winCondition = 'TOTAL_TIME';
    }
  }

  async create(): Promise<void> {
    this.creating = true;
    this.errorMessage = '';
    try {
      const winCondition = this.turnsPerTeam === 1 ? 'TOTAL_TIME' : this.winCondition;
      this.createdLobby = await this.gameFacade.createGame(
        this.mode,
        this.turnsPerTeam,
        winCondition,
        false,
        this.hostDisplayName,
      );
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo crear la partida.';
    } finally {
      this.creating = false;
    }
  }

  goToLobby(): void {
    if (!this.createdLobby) {
      return;
    }
    this.router.navigate(['/lobby', this.createdLobby.gameId]);
  }
}
