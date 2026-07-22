import { Component, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { User } from 'firebase/auth';
import { FirebaseGameClientService } from '../../services/firebase-game-client.service';

type QuestionCategory = {
  key: string;
  name: string;
  cost: string | null;
  time: string | null;
  items: QuestionItem[];
};

type QuestionItem = {
  label?: string;
  prompt?: string;
  answerGroups?: AnswerGroup[];
};

type AnswerGroup = {
  label: string;
  options: string[];
  optionsByAnswer?: Record<string, string[]>;
};

type QuestionsFile = {
  questions: Record<
    string,
    {
      name: string;
      cost: string | null;
      time: string | null;
      items?: QuestionItem[];
    }
  >;
};

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})

export class HomePage implements OnInit {
  public questionCategories: QuestionCategory[] = [];
  public selectedCategory: QuestionCategory | null = null;
  public readonly user$: Observable<User | null>;
  public authErrorMessage = '';
  public authLoading = false;

  public constructor(
    private readonly alertController: AlertController,
    private readonly firebaseClient: FirebaseGameClientService,
  ) {
    this.user$ = this.firebaseClient.user$;
  }

  public async ngOnInit(): Promise<void> {
    const response = await fetch('assets/questions/Preguntas_CABA.json');
    const questionsData = (await response.json()) as QuestionsFile;

    this.questionCategories = Object.entries(questionsData.questions).map(([key, category]) => ({
      key,
      name: category.name,
      cost: category.cost,
      time: category.time,
      items: category.items ?? [],
    }));
  }

  public onSelectCategory(category: QuestionCategory): void {
    this.selectedCategory = category;
  }

  public async signInWithGoogle(): Promise<void> {
    this.authLoading = true;
    this.authErrorMessage = '';
    try {
      await this.firebaseClient.signInWithGoogle();
    } catch (error) {
      this.authErrorMessage = error instanceof Error ? error.message : 'No se pudo entrar con Google.';
    } finally {
      this.authLoading = false;
    }
  }

  public async signOut(): Promise<void> {
    this.authLoading = true;
    this.authErrorMessage = '';
    try {
      await this.firebaseClient.signOut();
    } catch (error) {
      this.authErrorMessage = error instanceof Error ? error.message : 'No se pudo cerrar sesión.';
    } finally {
      this.authLoading = false;
    }
  }

  public async onQuestionClick(question: QuestionItem): Promise<void> {
    const questionText = this.questionText(question);
    const alert = await this.alertController.create({
      header: 'Confirmar pregunta',
      message: questionText,
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Confirmar pregunta',
          role: 'confirm',
        },
      ],
    });

    await alert.present();
  }

  public questionText(question: QuestionItem): string {
    const text = question.prompt ?? question.label ?? 'Pregunta sin texto';
    const answerText = this.answerGroupsText(question);
    return answerText ? `${text} ${answerText}` : text;
  }

  public answerGroupsText(question: QuestionItem): string {
    if (!question.answerGroups?.length) {
      return '';
    }

    return question.answerGroups
      .map(group => this.answerGroupText(group))
      .join(' ');
  }

  public answerGroupText(group: AnswerGroup): string {
    if (group.optionsByAnswer) {
      const options = Object.entries(group.optionsByAnswer)
        .map(([answer, values]) => `si ${answer}: ${values.join(' / ')}`)
        .join('; ');
      return `${group.label}: ${options}.`;
    }

    return `${group.label}: ${group.options.join(' / ')}.`;
  }
}
