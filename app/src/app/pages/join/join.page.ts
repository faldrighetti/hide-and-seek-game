import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GameFacadeService } from '../../services/game-facade';
import { FirebaseGameClientService } from '../../services/firebase-game-client.service';
import { GameMode, GamePreview } from '../../models/core-model';

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
  private readonly firebaseClient = inject(FirebaseGameClientService);

  gameId = '';
  displayName = '';
  joining = false;
  previewLoading = false;
  signingIn = false;
  preview: GamePreview | null = null;
  needsSignIn = false;
  errorMessage = '';

  async ngOnInit(): Promise<void> {
    const gameId = this.route.snapshot.paramMap.get('gameId');
    if (gameId) {
      this.gameId = gameId.toUpperCase();
      await this.lookupGame(true);
    }
  }

  clearPreview(): void {
    this.preview = null;
    this.errorMessage = '';
  }

  async lookupGame(redirectMember = false): Promise<void> {
    const normalizedGameId = this.gameId.trim().toUpperCase();
    if (!normalizedGameId) {
      this.errorMessage = 'Ingresá el código de la partida.';
      return;
    }
    this.gameId = normalizedGameId;
    this.previewLoading = true;
    this.errorMessage = '';
    try {
      const user = await this.firebaseClient.currentUserAfterAuthReady();
      if (!user) {
        this.needsSignIn = true;
        return;
      }
      this.needsSignIn = false;
      this.preview = await this.gameFacade.previewGame(normalizedGameId);
      if (redirectMember && this.preview.alreadyMember) this.continueToGame(this.preview);
    } catch (error) {
      this.preview = null;
      this.errorMessage = this.friendlyError(error);
    } finally {
      this.previewLoading = false;
    }
  }

  async signIn(): Promise<void> {
    this.signingIn = true;
    this.errorMessage = '';
    try {
      await this.firebaseClient.signInWithGoogle();
      await this.lookupGame(true);
    } catch (error) {
      this.errorMessage = this.friendlyError(error);
    } finally {
      this.signingIn = false;
    }
  }

  async join(): Promise<void> {
    const normalizedGameId = this.gameId.trim().toUpperCase();
    const name = this.displayName.trim();

    if (!normalizedGameId) return;

    this.joining = true;
    this.errorMessage = '';
    try {
      await this.gameFacade.joinGame(normalizedGameId, name);
      this.router.navigate(['/lobby', normalizedGameId]);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo unir a la partida.';
    } finally {
      this.joining = false;
    }
  }

  continueToGame(preview: GamePreview): void {
    this.router.navigate(preview.status === 'LOBBY' ? ['/lobby', preview.gameId] : ['/game', preview.gameId]);
  }

  modeLabel(mode: GameMode): string {
    const labels: Record<GameMode, string> = {
      INDIVIDUAL_1v1: '1 vs. 1', INDIVIDUAL_3: 'Individual de 3',
      TEAMS_2v2: 'Equipos 2 vs. 2', TEAMS_2v2v2: 'Equipos 2 vs. 2 vs. 2',
    };
    return labels[mode];
  }

  private friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('not-found')) return 'No encontramos una partida con ese código. Revisalo e intentá nuevamente.';
    if (message.includes('unavailable') || !navigator.onLine) return 'No hay conexión. Revisá la señal y volvé a intentar.';
    return message || 'No se pudo consultar la partida. Volvé a intentar.';
  }
}
