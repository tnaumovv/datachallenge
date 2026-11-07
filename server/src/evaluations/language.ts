/** A conservative script check, not a language model or a semantic correctness guarantee. */
export function hasRussianExplanation(text: string, sourceTexts: string[]): boolean {
  const foreignCyrillic = /[әғқңөұүһіїєґ]/iu;
  let prose = text.replace(/«([^»]+)»|"([^"]+)"|“([^”]+)”/gu, (quote, ...groups) => {
    const content = groups.slice(0, 3).find((group) => typeof group === 'string');
    return content && sourceTexts.some((source) => source.includes(content)) ? ' ' : quote;
  });
  // Source names can contain Kazakh letters without being surrounded by quotation marks.
  prose = prose.replace(/\p{L}+/gu, (word) =>
    foreignCyrillic.test(word) && sourceTexts.some((source) => source.includes(word)) ? ' ' : word,
  );
  return /[а-яё]/iu.test(prose) && !foreignCyrillic.test(prose);
}
