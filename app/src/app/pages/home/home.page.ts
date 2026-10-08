import { Component, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { User } from 'firebase/auth';
import { FirebaseGameClientService } from '../../services/firebase-game-client.service';
import { GameFacadeService } from '../../services/game-facade';
import { ActiveGameSummary, GameMode, Phase } from '../../models/core-model';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnDestroy {
  public readonly user$: Observable<User | null>;
  public authErrorMessage = '';
  public authLoading = false;
  public activeGame: ActiveGameSummary | null = null;
  public activeGameLoading = true;
  public activeGameErrorMessage = '';
  private readonly authSubscription: Subscription;

  public constructor(
    private readonly firebaseClient: FirebaseGameClientService,
    private readonly gameFacade: GameFacadeService,
  ) {
    this.user$ = this.firebaseClient.user$;
    this.authSubscription = this.user$.subscribe(user => {
      if (!user) {
        this.activeGame = null;
        this.activeGameLoading = false;
        this.activeGameErrorMessage = '';
        return;
      }
      void this.loadActiveGame();
    });
  }

  public ngOnDestroy(): void {
    this.authSubscription.unsubscribe();
  }

  public async ionViewWillEnter(): Promise<void> {
    if (this.activeGameLoading) {
      return;
    }
    const user = await this.firebaseClient.currentUserAfterAuthReady();
    if (user) {
      await this.loadActiveGame();
    }
  }

  public async signInWithGoogle(): Promise<void> {
    this.authLoading = true;
    this.authErrorMessage = '';
    try {
      await this.firebaseClient.signInWithGoogle();
    } catch (error) {
      this.authErrorMessage = error instanceof Error ? error.message : 'No se pudo entrar con Google.';
    } finally {
      this.authLoading = false;
    }
  }

  public async signOut(): Promise<void> {
    this.authLoading = true;
    this.authErrorMessage = '';
    try {
      await this.firebaseClient.signOut();
    } catch (error) {
      this.authErrorMessage = error instanceof Error ? error.message : 'No se pudo cerrar sesión.';
    } finally {
      this.authLoading = false;
    }
  }

  public firstName(user: User): string {
    const displayName = user.displayName?.trim();
    if (displayName) {
      return displayName.split(/\s+/)[0];
    }

    return user.email?.split('@')[0] ?? 'Jugador';
  }

  public activeGameLink(game: ActiveGameSummary): string[] {
    return game.status === 'LOBBY' ? ['/lobby', game.gameId] : ['/game', game.gameId];
  }

  public statusLabel(game: ActiveGameSummary): string {
    return game.status === 'LOBBY' ? 'En el lobby' : 'En juego';
  }

  public roleLabel(game: ActiveGameSummary): string {
    const labels: Record<ActiveGameSummary['role'], string> = {
      HIDER: 'Escondido',
      SEEKER: 'Buscador',
      HOST: 'Anfitrión',
      PLAYER: 'Jugador',
    };
    return labels[game.role];
  }

  public phaseLabel(phase: Phase | null): string {
    const labels: Record<Phase, string> = {
      INTERMISSION: 'Preparación',
      ESCAPE: 'Escape',
      CHASE: 'Búsqueda',
      ENDED: 'Finalizada',
    };
    return phase ? labels[phase] : 'Sin iniciar';
  }

  public modeLabel(mode: GameMode): string {
    const labels: Record<GameMode, string> = {
      INDIVIDUAL_1v1: '1 vs. 1',
      INDIVIDUAL_3: 'Individual de 3',
      TEAMS_2v2: 'Equipos 2 vs. 2',
      TEAMS_2v2v2: 'Equipos 2 vs. 2 vs. 2',
    };
    return labels[mode];
  }

  private async loadActiveGame(): Promise<void> {
    this.activeGameLoading = true;
    this.activeGameErrorMessage = '';
    try {
      this.activeGame = await this.gameFacade.getMyActiveGame();
    } catch (error) {
      this.activeGame = null;
      this.activeGameErrorMessage = this.activeGameLoadError(error);
    } finally {
      this.activeGameLoading = false;
    }
  }

  private activeGameLoadError(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    const message = error instanceof Error ? error.message.trim() : '';

    if (code === 'functions/internal' || message.toUpperCase() === 'INTERNAL') {
      return 'No se pudo consultar tu partida activa. Volvé a intentar en unos segundos.';
    }

    return message || 'No se pudo consultar tu partida activa.';
  }
}
