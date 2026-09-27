import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FirebaseGameClientService } from '../services/firebase-game-client.service';

export const authGuard: CanActivateFn = async () => {
  const firebaseClient = inject(FirebaseGameClientService);
  const router = inject(Router);
  const user = await firebaseClient.currentUserAfterAuthReady();

  return user ? true : router.createUrlTree(['/']);
};