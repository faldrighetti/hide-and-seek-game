import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GameFacadeService } from '../../services/game-facade';

@Component({
  selector: 'app-join',
  templateUrl: './join.page.html',
  styleUrls: ['./join.page.scss'],
  standalone: false,
})
export class JoinPage implements OnInit {
  private readonly gameFacade = inject(GameFacadeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  gameId = '';
  displayName = '';

  ngOnInit(): void {
    const gameId = this.route.snapshot.paramMap.get('gameId');
    if (gameId) this.gameId = gameId.toUpperCase();
  }

  join(): void {
    const normalizedGameId = this.gameId.trim().toUpperCase();
    const name = this.displayName.trim();

    if (!normalizedGameId || !name) return;

    this.gameFacade.joinGame(normalizedGameId, name);
    this.router.navigate(['/lobby', normalizedGameId]);
  }
}