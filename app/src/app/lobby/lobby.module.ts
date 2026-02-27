import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { LobbyPageRoutingModule } from './lobby-routing.module';
import { LobbyPage } from './lobby.page';

@NgModule({
  imports: [CommonModule, IonicModule, LobbyPageRoutingModule],
  declarations: [LobbyPage],
})
export class LobbyPageModule {}