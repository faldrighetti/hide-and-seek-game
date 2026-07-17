import { validateCardsCatalog } from './card-catalog.service';

describe('validateCardsCatalog', () => {
  it('defaults missing enabled to true and filters disabled cards', () => {
    const result = validateCardsCatalog({
      maldiciones: [
        { id: 1, nombre: 'A', texto_ui: { efecto: 'Desc' } },
        { id: 2, nombre: 'B', enabled: false, texto_ui: { efecto: 'Desc' } },
      ],
    });

    expect(result.cards.length).toBe(2);
    expect(result.enabledCards.map(card => card.id)).toEqual([1]);
  });

  it('reports duplicate ids and declared curse count mismatch', () => {
    const result = validateCardsCatalog({
      mazo: { mazo_escondedor: { cantidad_maldiciones_en_mazo: 3 } },
      maldiciones: [
        { id: 1, nombre: 'A', texto_ui: { efecto: 'Desc' } },
        { id: 1, nombre: 'B', texto_ui: { efecto: 'Desc' } },
      ],
    });

    expect(result.issues.some(issue => issue.message.includes('Duplicate card id'))).toBeTrue();
    expect(result.issues.some(issue => issue.message.includes('Declared curse count'))).toBeTrue();
  });
});
