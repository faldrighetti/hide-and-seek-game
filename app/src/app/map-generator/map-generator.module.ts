import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { MapGeneratorRoutingModule } from './map-generator-routing.module';
import { MapGeneratorPage } from './map-generator.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, MapGeneratorRoutingModule],
  declarations: [MapGeneratorPage],
})
export class MapGeneratorModule {}
