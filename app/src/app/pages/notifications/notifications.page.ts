import { Component, inject } from '@angular/core';
import { NotificationPreferences } from '../../models/core-model';
import { GameFacadeService } from '../../services/game-facade';
import { PushNotificationService, PushStatus } from '../../services/push-notification.service';

interface NotificationCategory {
  key: string;
  label: string;
}

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false,
})
export class NotificationsPage {
  private readonly gameFacade = inject(GameFacadeService);
  private readonly pushNotifications = inject(PushNotificationService);

  readonly categories: NotificationCategory[] = [
    { key: 'phase', label: 'Fases' },
    { key: 'turn', label: 'Turnos' },
    { key: 'base_station', label: 'Estación base' },
    { key: 'question', label: 'Preguntas' },
    { key: 'loot', label: 'Loot' },
    { key: 'curse', label: 'Maldiciones' },
    { key: 'endgame', label: 'Endgame' },
    { key: 'capture', label: 'Captura' },
    { key: 'safety', label: 'Seguridad' },
    { key: 'presence', label: 'Presencia' },
    { key: 'operations', label: 'Operación' },
  ];

  preferences: NotificationPreferences = { criticalAlwaysEnabled: true, medium: {}, low: {} };
  loading = false;
  saving = false;
  errorMessage = '';
  savedMessage = '';
  pushStatus: PushStatus = 'unsupported';
  pushActivating = false;
  pushActivatedForSession = false;
  pushError = '';

  constructor() {
    void this.load();
    void this.loadPushStatus();
  }

  async loadPushStatus(): Promise<void> {
    this.pushStatus = await this.pushNotifications.refreshStatus();
  }

  async activatePush(): Promise<void> {
    this.pushActivating = true;
    this.pushError = '';
    try {
      await this.pushNotifications.enable();
      this.pushActivatedForSession = true;
      await this.loadPushStatus();
    } catch (error) {
      this.pushError = error instanceof Error ? error.message : 'No se pudieron activar las notificaciones.';
    } finally {
      this.pushActivating = false;
    }
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    this.savedMessage = '';
    try {
      this.preferences = this.withDefaults(await this.gameFacade.getNotificationPreferences());
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudieron cargar las preferencias.';
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    this.errorMessage = '';
    this.savedMessage = '';
    try {
      this.preferences = this.withDefaults(await this.gameFacade.updateNotificationPreferences({
        medium: this.preferences.medium,
        low: this.preferences.low,
      }));
      this.savedMessage = 'Preferencias guardadas.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudieron guardar las preferencias.';
    } finally {
      this.saving = false;
    }
  }

  setPreference(level: 'medium' | 'low', key: string, enabled: boolean): void {
    this.preferences = {
      ...this.preferences,
      [level]: { ...this.preferences[level], [key]: enabled },
    };
  }

  private withDefaults(preferences: NotificationPreferences): NotificationPreferences {
    const defaults = this.categories.reduce<Record<string, boolean>>((acc, category) => {
      acc[category.key] = true;
      return acc;
    }, {});
    return {
      criticalAlwaysEnabled: true,
      medium: { ...defaults, ...preferences.medium },
      low: { ...defaults, ...preferences.low },
    };
  }
}
