import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { NotificationsPageRoutingModule } from './notifications-routing.module';
import { NotificationsPage } from './notifications.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, NotificationsPageRoutingModule],
  declarations: [NotificationsPage],
})
export class NotificationsPageModule {}
