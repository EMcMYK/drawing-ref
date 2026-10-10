// What each launch category pulls, from which source. Only sources that need
// no API key for now (Smithsonian and Openverse come later).
// Met department IDs: 4 = Arms and Armor, 18 = Musical Instruments.
// iNaturalist taxa: 1 Animalia, 40151 mammals, 3 birds, 26036 reptiles,
// 20978 amphibians, 47158 insects, 47126 Plantae, 47125 flowering plants.

export const CATEGORIES = [
  {
    id: 'animals',
    label: 'Animals',
    sources: [
      ['inat', { taxonId: 40151 }, 200],
      ['inat', { taxonId: 3 }, 200],
      ['inat', { taxonId: 26036 }, 100],
      ['inat', { taxonId: 20978 }, 80],
      ['inat', { taxonId: 47158 }, 120],
      ['wikimedia', { categories: ['Category:Featured pictures of mammals', 'Category:Featured pictures of birds', 'Category:Featured pictures of reptiles', 'Category:Featured pictures of insects'] }, 200],
    ],
  },
  {
    id: 'plants',
    label: 'Plants and flowers',
    sources: [
      ['inat', { taxonId: 47125 }, 450],
      ['inat', { taxonId: 47126 }, 250],
      ['wikimedia', { categories: ['Category:Featured pictures of plants', 'Category:Featured pictures of flowers'] }, 250],
    ],
  },
  {
    id: 'sculpture',
    label: 'Sculpture and figure',
    sources: [
      ['cleveland', { type: 'Sculpture' }, 350],
      ['aic', { type: 'Sculpture' }, 350],
      ['met', { search: 'sculpture', classification: /sculpture/i }, 300],
    ],
  },
  {
    id: 'objects',
    label: 'Objects and vases',
    sources: [
      ['cleveland', { type: 'Ceramic' }, 250],
      ['aic', { type: 'Vessel' }, 200],
      ['museums-victoria', { query: 'bottle' }, 100],
      ['museums-victoria', { query: 'teapot' }, 80],
      ['museums-victoria', { query: 'tool' }, 120],
      ['museums-victoria', { query: 'lamp' }, 80],
      ['met', { search: 'vase', classification: /ceramic|glass|vase|vessel/i }, 150],
    ],
  },
  {
    id: 'machines',
    label: 'Aircraft, spacecraft and machines',
    sources: [
      ['nasa', { q: 'aircraft' }, 250],
      ['nasa', { q: 'spacecraft' }, 150],
      ['nasa', { q: 'rocket launch' }, 100],
      ['nasa', { q: 'rover' }, 80],
      ['museums-victoria', { query: 'engine' }, 100],
      ['museums-victoria', { query: 'locomotive' }, 60],
      ['wikimedia', { categories: ['Category:Featured pictures of aircraft', 'Category:Featured pictures of vehicles'] }, 200],
    ],
  },
  {
    id: 'architecture',
    label: 'Architecture',
    sources: [
      ['wikimedia', { categories: ['Category:Featured pictures of architecture', 'Category:Featured pictures of buildings', 'Category:Featured pictures of churches', 'Category:Featured pictures of bridges'] }, 800],
      ['museums-victoria', { query: 'building' }, 150],
    ],
  },
  {
    id: 'weapons-armor',
    label: 'Weapons and armor',
    sources: [
      ['met', { departmentId: 4 }, 400],
      ['cleveland', { type: 'Arms and Armor' }, 350],
      ['aic', { type: 'Armor' }, 150],
      ['aic', { type: 'Arms' }, 100],
    ],
  },
  {
    id: 'instruments',
    label: 'Musical instruments',
    sources: [
      ['met', { departmentId: 18 }, 500],
      ['cleveland', { type: 'Musical Instrument' }, 80],
      ['museums-victoria', { query: 'musical instrument' }, 200],
    ],
  },
];

export const CAP_PER_CATEGORY = 1000;
export const MIN_PER_CATEGORY = 300;
