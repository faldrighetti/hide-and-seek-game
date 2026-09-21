import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from 'firebase/auth';
import { FirebaseGameClientService } from '../../services/firebase-game-client.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  public readonly user$: Observable<User | null>;
  public authErrorMessage = '';
  public authLoading = false;

  public constructor(
    private readonly firebaseClient: FirebaseGameClientService,
  ) {
    this.user$ = this.firebaseClient.user$;
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
}
