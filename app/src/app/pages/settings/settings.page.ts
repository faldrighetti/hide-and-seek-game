import { Component, inject } from '@angular/core';
import { NotificationPreferences } from '../../models/core-model';
import { GameFacadeService } from '../../services/game-facade';

interface NotificationCategory {
  key: string;
  label: string;
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  private readonly gameFacade = inject(GameFacadeService);

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

  preferences: NotificationPreferences = {
    criticalAlwaysEnabled: true,
    medium: {},
    low: {},
  };
  loading = false;
  saving = false;
  errorMessage = '';
  savedMessage = '';

  constructor() {
    void this.load();
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
      [level]: {
        ...this.preferences[level],
        [key]: enabled,
      },
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
