import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import { GameFacadeService } from '../../services/game-facade';
import { GameBlueprint } from '../../models/core-model';

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
  standalone: false,
})
export class GamePage {
  private readonly route = inject(ActivatedRoute);
  private readonly gameFacade = inject(GameFacadeService);

  readonly gameId = this.route.snapshot.paramMap.get('gameId') ?? '';
  readonly blueprint$: Observable<GameBlueprint> = this.gameFacade.blueprint$;

  constructor() {
    this.gameFacade.loadGame(this.gameId);
    this.showData();
  }

  async showData(): Promise<void> {
    const res = await fetch(`/../../assets/stations.json`, { cache: 'force-cache' });
    const data = await res.json();
    console.log(data.transport);
  }

  setPhase(phase: GameBlueprint['currentTurn']['phase']): void {
    this.gameFacade.setPhase(phase);
  }

  voteFound(teamId: string): void {
    this.gameFacade.voteFound(teamId);
  }

  formatTime(seconds: number): string {
    const sign = seconds < 0 ? '-' : '';
    const absolute = Math.abs(seconds);
    const hrs = Math.floor(absolute / 3600);
    const mins = Math.floor((absolute % 3600) / 60);
    const secs = absolute % 60;
    return `${sign}${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }
}