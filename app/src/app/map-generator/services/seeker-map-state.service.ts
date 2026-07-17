import { Injectable } from '@angular/core';
import { ConstraintRecord, SeekerMapState } from '../models/map-constraints.model';

const STORAGE_KEY = 'hideSeek.mapGenerator.seekerState.v1';

@Injectable({ providedIn: 'root' })
export class SeekerMapStateService {
  load(): SeekerMapState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { records: [], cursor: 0 };
    }

    try {
      const parsed = JSON.parse(raw) as SeekerMapState;
      return {
        records: Array.isArray(parsed.records) ? parsed.records : [],
        cursor: Number.isInteger(parsed.cursor) ? parsed.cursor : 0,
      };
    } catch {
      return { records: [], cursor: 0 };
    }
  }

  save(state: SeekerMapState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  append(state: SeekerMapState, record: ConstraintRecord): SeekerMapState {
    const records = [...state.records.slice(0, state.cursor), record];
    const next = { records, cursor: records.length };
    this.save(next);
    return next;
  }

  undo(state: SeekerMapState): SeekerMapState {
    const next = { ...state, cursor: Math.max(0, state.cursor - 1) };
    this.save(next);
    return next;
  }

  redo(state: SeekerMapState): SeekerMapState {
    const next = { ...state, cursor: Math.min(state.records.length, state.cursor + 1) };
    this.save(next);
    return next;
  }
}
