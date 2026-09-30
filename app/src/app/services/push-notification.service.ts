import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, MessagePayload, onMessage } from 'firebase/messaging';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { FirebaseGameClientService } from './firebase-game-client.service';

export type PushStatus = 'unsupported' | 'needs-install' | 'not-configured' | 'prompt' | 'enabled' | 'blocked';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly statusSubject = new BehaviorSubject<PushStatus>('unsupported');
  readonly status$ = this.statusSubject.asObservable();
  private foregroundListenerAttached = false;

  constructor(private readonly firebaseClient: FirebaseGameClientService) {}

  async refreshStatus(): Promise<PushStatus> {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) {
      return this.setStatus('unsupported');
    }
    if (this.isIos() && !this.isStandalone()) return this.setStatus('needs-install');
    if (!environment.firebase.webPushVapidKey) return this.setStatus('not-configured');
    if (Notification.permission === 'denied') return this.setStatus('blocked');
    return this.setStatus(Notification.permission === 'granted' ? 'enabled' : 'prompt');
  }

  async enable(): Promise<void> {
    const status = await this.refreshStatus();
    if (status !== 'prompt' && status !== 'enabled') {
      throw new Error(this.messageForStatus(status));
    }

    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessaging(getApp());
    const token = await getToken(messaging, {
      vapidKey: environment.firebase.webPushVapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error('El navegador no devolvió un identificador para notificaciones.');

    await this.firebaseClient.callFunction<{ token: string }, { ok: boolean }>('registerPushToken', { token });
    this.attachForegroundListener(messaging);
    this.setStatus('enabled');
  }

  async disable(): Promise<void> {
    if (!(await isSupported())) return;
    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessaging(getApp());
    const token = await getToken(messaging, {
      vapidKey: environment.firebase.webPushVapidKey,
      serviceWorkerRegistration: registration,
    });
    if (token) await this.firebaseClient.callFunction<{ token: string }, { ok: boolean }>('unregisterPushToken', { token });
    await deleteToken(messaging);
    await this.refreshStatus();
  }

  private attachForegroundListener(messaging: ReturnType<typeof getMessaging>): void {
    if (this.foregroundListenerAttached) return;
    onMessage(messaging, (payload: MessagePayload) => {
      const notification = payload.notification;
      if (notification?.title && Notification.permission === 'granted') {
        new Notification(notification.title, { body: notification.body, icon: '/assets/icon/favicon.png' });
      }
    });
    this.foregroundListenerAttached = true;
  }

  private setStatus(status: PushStatus): PushStatus {
    this.statusSubject.next(status);
    return status;
  }

  private isIos(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  private isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  }

  private messageForStatus(status: PushStatus): string {
    const messages: Record<Exclude<PushStatus, 'prompt' | 'enabled'>, string> = {
      unsupported: 'Este navegador no permite notificaciones push.',
      'needs-install': 'En iPhone, instalá el juego en la pantalla de inicio antes de activar notificaciones.',
      'not-configured': 'Las notificaciones todavía no están configuradas para esta versión del juego.',
      blocked: 'Las notificaciones están bloqueadas en el navegador.',
    };
    if (status === 'prompt' || status === 'enabled') return '';
    return messages[status];
  }
}
