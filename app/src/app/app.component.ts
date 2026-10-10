import { Component, HostListener, OnInit } from '@angular/core';
import { PushNotificationService, PushStatus } from './services/push-notification.service';
import { ThemeService } from './services/theme.service';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  isOnline = navigator.onLine;
  showInstallGuide = false;
  isIos = false;
  pushStatus: PushStatus = 'unsupported';
  pushError = '';
  private deferredInstallPrompt?: BeforeInstallPromptEvent;

  constructor(
    private readonly pushNotifications: PushNotificationService,
    private readonly theme: ThemeService,
  ) {
    this.theme.isDarkMode();
  }

  ngOnInit(): void {
    const userAgent = navigator.userAgent;
    this.isIos = /iPad|iPhone|iPod/.test(userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;
    this.showInstallGuide = this.isIos && !this.isStandalone();
    void this.loadPushStatus();
  }

  async loadPushStatus(): Promise<void> {
    this.pushStatus = await this.pushNotifications.refreshStatus();
  }

  async enablePush(): Promise<void> {
    this.pushError = '';
    try {
      await this.pushNotifications.enable();
      await this.loadPushStatus();
    } catch (error) {
      this.pushError = error instanceof Error ? error.message : 'No se pudieron activar las notificaciones.';
    }
  }

  @HostListener('window:online')
  onOnline(): void {
    this.isOnline = true;
  }

  @HostListener('window:offline')
  onOffline(): void {
    this.isOnline = false;
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(event: BeforeInstallPromptEvent): void {
    event.preventDefault();
    this.deferredInstallPrompt = event;
    this.showInstallGuide = !this.isStandalone();
  }

  @HostListener('window:appinstalled')
  onAppInstalled(): void {
    this.showInstallGuide = false;
    this.deferredInstallPrompt = undefined;
  }

  async install(): Promise<void> {
    if (!this.deferredInstallPrompt) return;
    await this.deferredInstallPrompt.prompt();
    const choice = await this.deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') this.showInstallGuide = false;
    this.deferredInstallPrompt = undefined;
  }

  dismissInstallGuide(): void {
    this.showInstallGuide = false;
  }

  private isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  }
}
