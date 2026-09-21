import { Component } from '@angular/core';

type RuleSection = {
  title: string;
  items: string[];
};

@Component({
  selector: 'app-rules',
  templateUrl: './rules.page.html',
  styleUrls: ['./rules.page.scss'],
  standalone: false,
})
export class RulesPage {
  public readonly ruleSections: RuleSection[] = [
    {
      title: 'Estructura del juego',
      items: [
        'Cada partida se divide en turnos. En cada turno hay un equipo escondido y el resto de equipos son buscadores.',
        'Cada turno tiene fase de escape, fase de búsqueda, posible endgame, captura o vencimiento del tiempo, e intervalo.',
        'El tiempo oficial y el orden de las acciones los determina el servidor.',
        'El equipo ganador es el que, cuando todos los equipos tuvieron su/s turno/s de esconderse, termina con el tiempo más largo de escondite en un solo turno.',
      ],
    },
    {
      title: 'Duración y escape',
      items: [
        'La fase de escape dura 60 minutos.',
        'Los jugadores pueden moverse caminando, en subte, tren o colectivo. No pueden usar taxi, Uber, bicicleta u otros medios.',
        'Los buscadores no pueden mejorar deliberadamente su posición durante la fase de escape, salvo movimientos locales por necesidades prácticas.',
        'Por ejemplo, pueden trasladarse a un baño o un lugar para almorzar, pero no pueden hacerlo en una distancia larga que le signifique una ventaja.',
        'Un turno completo dura como máximo 5 horas computables. Las pausas reglamentarias no cuentan para ese máximo.',
      ],
    },
    {
      title: 'Estación base y zona de escondite',
      items: [
        'Durante el escape, el escondido elige una estación jugable como base y puede cambiarla hasta que la confirme manualmente o la confirme el sistema al final de la fase de escape.',
        'Si no confirma una estación antes de que termine el escape, el servidor asigna la estación jugable más cercana a la última ubicación válida.',
        'La zona de escondite es un círculo de 600 metros de radio alrededor de la estación base.',
        'Durante la búsqueda, el escondido debe permanecer dentro de su zona de escondite y no puede cambiar de estación base salvo mediante la carta "Salí de ahí".',
      ],
    },
    {
      title: 'Buscadores',
      items: [
        'Los integrantes de cada equipo deben permanecer juntos.',
        'Cualquiera de los buscadores puede enviar preguntas.',
        'Los buscadores deben compartir ubicación con el equipo escondido.',
      ],
    },
    {
      title: 'Preguntas y respuestas',
      items: [
        'Solo puede existir una pregunta pendiente. Los buscadores deben esperar a que el escondido responda antes de enviar otra pregunta.',
        'Cuando el servidor acepta una pregunta válida, la categoría queda bloqueada durante 15 minutos para todo el equipo buscador.',
        'El equipo escondido debe responder con la verdad. Tiene 10 minutos para responder. En caso de no hacerlo, se lo penalizará con una reducción de 30 minutos en el tiempo de escape.',
        'Las respuestas pueden corregirse.',
      ],
    },
    {
      title: 'Fotos',
      items: [
        'Las preguntas de foto se resuelven externamente por Whatsapp. La app solo registra que la foto fue enviada, recibida y validada/rebotada.',
        'Está completamente permitido y recomendado tachar o tapar textos visibles en carteles de calles, negocios u otras señales antes de enviar una foto.',
      ],
    },
    {
      title: 'Endgame y captura',
      items: [
        'El endgame se activa cuando los buscadores consultan y el escondido lo confirma. Para consultarlo, tienen que creer estar dentro de la zona de escondite y no estar subidos a ningún transporte.',
        'Una vez iniciado el endgame, el escondido debe quedarse fijo en un punto público, en planta baja y razonablemente visible. No tiene permitido cambiar de ubicación.',
        'Encontrar al escondido requiere reconocimiento inequívoco en persona y confirmacion manual entre jugadores.',
        'Para confirmar la captura al sistema, los buscadores deben realizar una confirmación manual y los escondidos deben confirmar la captura.',
        'Una vez que se confirma la captura, el turno termina e inicia la fase de intervalo. Los roles se invierten y al finalizar la fase de intervalo, empieza la fase de escape.'
      ],
    },
    {
      title: 'Cartas y maldiciones',
      items: [
        'Solo el escondido tiene mazo. Puede recibir cartas al responder preguntas y la mano tiene límite máximo de 6 cartas.',
        'Las maldiciones se activan cuando el servidor las valida y aplican al equipo buscador. El escondido puede aplicarlas cuando quiera y no tenga preguntas pendientes por responder.',
      ],
    },
    {
      title: 'Pausas y emergencias',
      items: [
        'La ubicación se coordina por fuera de la app. La app registra pausas y abandono técnico.',
      ],
    },
    {
      title: 'Reglas sociales',
      items: [
        'Algunas reglas se aplican por buena fe: no usar Street View, respetar los transportes permitidos y mantenerse juntos como buscadores.',
        'Las herramientas externas estan permitidas salvo Google Street View.',
        'Ante dudas o casos no cubiertos, los jugadores deben priorizar seguridad, juego limpio y acuerdo social. Se mantiene Whatsapp como canal secundario de comunicación entre los jugadores.',
      ],
    },
  ];
}
