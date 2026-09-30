import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

platformBrowserDynamic().bootstrapModule(AppModule)
  .then(() => {
    if (environment.production && 'serviceWorker' in navigator && window.isSecureContext) {
      return navigator.serviceWorker.register('/sw.js');
    }
    return undefined;
  })
  .catch(err => console.log(err));
