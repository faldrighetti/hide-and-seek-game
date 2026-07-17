import { Injectable } from '@angular/core';
import { Station } from '../../models/station.model';
import { ConstraintRecord, StationEvaluation } from '../models/map-constraints.model';
import { evaluateStationsFromHistory } from '../evaluators/manual-evaluator';

@Injectable({ providedIn: 'root' })
export class StationEvaluatorService {
  evaluate(stations: Station[], records: ConstraintRecord[]): StationEvaluation[] {
    return evaluateStationsFromHistory(stations, records);
  }
}
