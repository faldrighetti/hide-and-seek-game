import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('../app/pages/home/home.module').then(m => m.HomePageModule),
  },
  {
    path: 'create',
    loadChildren: () => import('../app/pages/create/create.module').then(m => m.CreatePageModule),
  },
  {
    path: 'join',
    loadChildren: () => import('../app/pages/join/join.module').then(m => m.JoinPageModule),
  },
  { 
    path: 'join/:gameId', 
    loadChildren: () => import('../app/pages/join/join.module').then(m => m.JoinPageModule) 
  },
  {
    path: 'lobby/:gameId',
    loadChildren: () => import('../app/pages/lobby/lobby.module').then(m => m.LobbyPageModule),
  },
  {
    path: 'game/:gameId',
    loadChildren: () => import('../app/pages/game/game.module').then(m => m.GamePageModule),
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}