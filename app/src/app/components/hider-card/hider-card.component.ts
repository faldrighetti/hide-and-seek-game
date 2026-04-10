import { Component, Input } from '@angular/core';
import { HiderCardData } from 'src/app/models/hider-card-data';

@Component({
  selector: 'app-hider-card',
  templateUrl: './hider-card.component.html',
  styleUrls: ['./hider-card.component.scss'],
  standalone: false,
})
export class HiderCardComponent {
  @Input({ required: true }) card!: HiderCardData;
}