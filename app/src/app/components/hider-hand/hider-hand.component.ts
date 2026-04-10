
import { Component, Input } from '@angular/core';
import { HiderCardData } from 'src/app/models/hider-card-data';

@Component({
  selector: 'app-hider-hand',
  templateUrl: './hider-hand.component.html',
  styleUrls: ['./hider-hand.component.scss'],
  standalone: false
})
export class HiderHandComponent {
  @Input() title = 'Mano';
  @Input() cards: HiderCardData[] = [];
}