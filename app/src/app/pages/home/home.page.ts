import { Component, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular';

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

  public constructor(private readonly alertController: AlertController) {}

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

  public async onQuestionClick(question: QuestionItem): Promise<void> {
    const questionText = question.prompt ?? question.label ?? 'Pregunta sin texto';
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
}