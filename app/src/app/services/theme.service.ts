import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const DARK_MODE_STORAGE_KEY = 'hide-and-seek:dark-mode';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly darkModeSubject = new BehaviorSubject<boolean>(this.readStoredPreference());
  readonly darkMode$ = this.darkModeSubject.asObservable();

  constructor() {
    this.apply(this.darkModeSubject.value);
  }

  isDarkMode(): boolean {
    return this.darkModeSubject.value;
  }

  setDarkMode(enabled: boolean): void {
    try {
      localStorage.setItem(DARK_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // El tema igual se aplica durante la sesión si el navegador bloquea el almacenamiento.
    }
    this.darkModeSubject.next(enabled);
    this.apply(enabled);
  }

  private readStoredPreference(): boolean {
    try {
      return localStorage.getItem(DARK_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private apply(enabled: boolean): void {
    document.documentElement.classList.toggle('ion-palette-dark', enabled);
    document.documentElement.style.colorScheme = enabled ? 'dark' : 'light';
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', enabled ? 'dark' : 'light');
  }
}
