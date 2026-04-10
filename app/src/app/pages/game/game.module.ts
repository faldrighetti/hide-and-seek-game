import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { GamePageRoutingModule } from './game-routing.module';
import { GamePage } from './game.page';
import { HiderUiModule } from '../../components/hider-ui.module';

@NgModule({
  imports: [CommonModule, IonicModule, GamePageRoutingModule, HiderUiModule],
  declarations: [GamePage],
})
export class GamePageModule {}