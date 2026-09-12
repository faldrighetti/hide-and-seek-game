import { Injectable } from '@angular/core';
import { ConstraintRecord, SeekerMapState } from '../models/map-constraints.model';

const STORAGE_KEY = 'hideSeek.mapGenerator.seekerState.v1';

@Injectable({ providedIn: 'root' })
export class SeekerMapStateService {
  load(scopeKey?: string | null): SeekerMapState {
    const raw = localStorage.getItem(this.storageKey(scopeKey));
    if (!raw) {
      return { records: [], cursor: 0 };
    }

    try {
      const parsed = JSON.parse(raw) as SeekerMapState;
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      return {
        records,
        cursor: Number.isInteger(parsed.cursor) ? Math.max(0, Math.min(parsed.cursor, records.length)) : 0,
      };
    } catch {
      return { records: [], cursor: 0 };
    }
  }

  save(state: SeekerMapState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  saveScoped(state: SeekerMapState, scopeKey?: string | null): void {
    localStorage.setItem(this.storageKey(scopeKey), JSON.stringify(state));
  }

  append(state: SeekerMapState, record: ConstraintRecord, scopeKey?: string | null): SeekerMapState {
    const records = [...state.records.slice(0, state.cursor), record];
    const next = { records, cursor: records.length };
    this.saveScoped(next, scopeKey);
    return next;
  }

  undo(state: SeekerMapState, scopeKey?: string | null): SeekerMapState {
    const next = { ...state, cursor: Math.max(0, state.cursor - 1) };
    this.saveScoped(next, scopeKey);
    return next;
  }

  redo(state: SeekerMapState, scopeKey?: string | null): SeekerMapState {
    const next = { ...state, cursor: Math.min(state.records.length, state.cursor + 1) };
    this.saveScoped(next, scopeKey);
    return next;
  }

  setRecordEnabled(state: SeekerMapState, recordId: string, enabled: boolean, scopeKey?: string | null): SeekerMapState {
    const next = {
      ...state,
      records: state.records.map(record => (
        record.id === recordId ? { ...record, enabled } : record
      )),
    };
    this.saveScoped(next, scopeKey);
    return next;
  }

  private storageKey(scopeKey?: string | null): string {
    const normalized = scopeKey?.trim();
    return normalized ? `${STORAGE_KEY}.${normalized}` : STORAGE_KEY;
  }
}
