import { Component } from "@angular/core";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebase";

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false
})
export class AppComponent {
  constructor() {
    onAuthStateChanged(auth, async (user) => {
      if (!user) await signInAnonymously(auth);
    });
  }
}