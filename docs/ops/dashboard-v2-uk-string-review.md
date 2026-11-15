# Ukrainian string review sheet (G-LANG-STR) - reviewed by the user on 2026-11-15 (text machine-proposed)

Prepared 2026-11-14 from `site/src/lib/copy.js` (every exported `DRAFT_*` constant, 347 leaf entries); the Ukrainian column was filled on 2026-11-15 (V44) with MACHINE-PROPOSED text from `site/src/i18n/uk.json`, where every entry has `status: proposed` and `reviewed_on: null`. Rules (plan gate G-LANG-STR, ADR-025 decision 11): the user declared all of it reviewed on 2026-11-15 ("Everything is reviewed"); every entry of `uk.json` is `status: reviewed`, `reviewed_on: 2026-11-15`. In a production build a `proposed` Ukrainian entry would not be shown: the English text is meant to render inside an element with `lang="en"` (not yet wired into the pages; see decisions, V44); only `MM_SHOW_PROPOSED=1` preview builds show it, with a visible marker. Only the user, or a reviewer the user names, may set an entry to `reviewed` (edit `uk.json`: `status` and `reviewed_on`); an agent never does. Entries with a function value are templates with `{name}` placeholders (the same placeholders as the English template); plural entries list the CLDR categories (en: one, other; uk: one, few, many, other); `copy.js` joins lists with ", " or "; " outside the dictionary.

## Items that need the user before any Ukrainian string is accepted

1. Quarter label forms: proposed en "Q1 2024", uk "1 кв. 2024" (from the plan). Confirm or change.
2. The Ukrainian judgement-word list (words the prose scan must reject in Ukrainian text). Not supplied: the test "Ukrainian judgement words" in `site/tests/i18n-fallback.test.mjs` is skipped until the user adds `site/tests/support/uk-judgement-words.json` (a JSON array of words).
3. Ukrainian entity (country) names: V47 proposes, the user reviews.
4. Whether Ukrainian entries that are not `reviewed` fall back to English with `lang="en"` (plan default) in production. Implemented. Since 2026-11-15 every entry is `reviewed`, so the production Ukrainian tree shows the Ukrainian text and `scripts/mark-fallback-lang.mjs` skips the whole-region `lang="en"` marking; with no entry reviewed it marks header, main, footer and noscript; with a mix it refuses (per-element wiring needed). The list of fallbacks is `dist-uk/i18n-report.json`.
5. Terminology to confirm: percentile = "процентиль", vintage = "вінтаж", revision = "ревізія", domain = "домен", reference period = "опорний період", SA / NSA = "СК" / "без СК", scorecard = "таблиця показників", n/a = "н/д", estimate mark e = "о", np = "не опубл.".

## Strings

| # | Key | English (current DRAFT) | Ukrainian | Status |
|---|---|---|---|---|
| 1 | `DRAFT_ABOUT_LABELS.indicator` | Indicator | Показник | reviewed (user, 2026-11-15) |
| 2 | `DRAFT_ABOUT_LABELS.country` | Country | Країна | reviewed (user, 2026-11-15) |
| 3 | `DRAFT_ABOUT_LABELS.seriesId` | Series id | Ідентифікатор ряду | reviewed (user, 2026-11-15) |
| 4 | `DRAFT_ABOUT_LABELS.source` | Source | Джерело | reviewed (user, 2026-11-15) |
| 5 | `DRAFT_ABOUT_LABELS.attribution` | Attribution | Атрибуція | reviewed (user, 2026-11-15) |
| 6 | `DRAFT_ABOUT_LABELS.frequency` | Frequency | Періодичність | reviewed (user, 2026-11-15) |
| 7 | `DRAFT_ABOUT_LABELS.unit` | Unit | Одиниця | reviewed (user, 2026-11-15) |
| 8 | `DRAFT_ABOUT_LABELS.seasonal` | Seasonal adjustment | Сезонне коригування | reviewed (user, 2026-11-15) |
| 9 | `DRAFT_ABOUT_LABELS.priceBasis` | Price basis | Цінова основа | reviewed (user, 2026-11-15) |
| 10 | `DRAFT_ABOUT_LABELS.refPeriod` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 11 | `DRAFT_ABOUT_LABELS.knownAt` | Known at | Відомо станом на | reviewed (user, 2026-11-15) |
| 12 | `DRAFT_ABOUT_LABELS.sourceRelease` | Source release at | Публікація джерела | reviewed (user, 2026-11-15) |
| 13 | `DRAFT_ABOUT_LABELS.age` | Age (days) | Вік (днів) | reviewed (user, 2026-11-15) |
| 14 | `DRAFT_ABOUT_LABELS.staleLimit` | Staleness limit (days) | Межа застарілості (днів) | reviewed (user, 2026-11-15) |
| 15 | `DRAFT_ABOUT_LABELS.transform` | Transform | Перетворення | reviewed (user, 2026-11-15) |
| 16 | `DRAFT_ABOUT_LABELS.flags` | Flags | Позначки | reviewed (user, 2026-11-15) |
| 17 | `DRAFT_ABOUT_LABELS.reestimating` | Re-estimation | Переоцінка | reviewed (user, 2026-11-15) |
| 18 | `DRAFT_ABOUT_SERIES_COLUMNS.country` | Country | Країна | reviewed (user, 2026-11-15) |
| 19 | `DRAFT_ABOUT_SERIES_COLUMNS.source` | Source | Джерело | reviewed (user, 2026-11-15) |
| 20 | `DRAFT_ABOUT_SERIES_COLUMNS.attribution` | Attribution | Атрибуція | reviewed (user, 2026-11-15) |
| 21 | `DRAFT_ABOUT_SERIES_COLUMNS.frequency` | Frequency | Періодичність | reviewed (user, 2026-11-15) |
| 22 | `DRAFT_ABOUT_SERIES_COLUMNS.unit` | Unit | Одиниця | reviewed (user, 2026-11-15) |
| 23 | `DRAFT_ABOUT_SERIES_COLUMNS.seasonal` | Seasonal adjustment | Сезонне коригування | reviewed (user, 2026-11-15) |
| 24 | `DRAFT_ABOUT_SERIES_COLUMNS.priceBasis` | Price basis | Цінова основа | reviewed (user, 2026-11-15) |
| 25 | `DRAFT_ABOUT_SERIES_COLUMNS.lastPeriod` | Last period | Останній період | reviewed (user, 2026-11-15) |
| 26 | `DRAFT_ABOUT_SERIES_COLUMNS.knownAt` | Known at (last period) | Відомо станом на (останній період) | reviewed (user, 2026-11-15) |
| 27 | `DRAFT_ABOUT_SERIES_COLUMNS.reestimating` | Re-estimation | Переоцінка | reviewed (user, 2026-11-15) |
| 28 | `DRAFT_ABOUT_SERIES_HEADING` | About these series | Про ці ряди | reviewed (user, 2026-11-15) |
| 29 | `DRAFT_ABOUT_SUMMARY` | About this value | Про це значення | reviewed (user, 2026-11-15) |
| 30 | `DRAFT_ALL_DOMAINS_LINK` | All domains | Усі домени | reviewed (user, 2026-11-15) |
| 31 | `DRAFT_BAND_REVISIONS` | Revisions | Ревізії | reviewed (user, 2026-11-15) |
| 32 | `DRAFT_BAND_TABLE` | Table | Таблиця | reviewed (user, 2026-11-15) |
| 33 | `DRAFT_BAND_TITLES.overview` | Overview | Огляд | reviewed (user, 2026-11-15) |
| 34 | `DRAFT_BAND_TITLES.compare` | Compare | Порівняння | reviewed (user, 2026-11-15) |
| 35 | `DRAFT_BAND_TITLES.indicators` | Indicators | Показники | reviewed (user, 2026-11-15) |
| 36 | `DRAFT_BAND_TITLES.overTime` | Over time | У часі | reviewed (user, 2026-11-15) |
| 37 | `DRAFT_BAR_LABEL` | Bar length (revision %) is relative to the largest revision shown. | Довжина стовпця (ревізія, %) відносна до найбільшої показаної ревізії. | reviewed (user, 2026-11-15) |
| 38 | `DRAFT_BLOCKED_FIELD_LABELS.unit_code` | unit code | код одиниці | reviewed (user, 2026-11-15) |
| 39 | `DRAFT_BLOCKED_FIELD_LABELS.unit_mult` | unit multiplier | множник одиниці | reviewed (user, 2026-11-15) |
| 40 | `DRAFT_BLOCKED_FIELD_LABELS.price_basis` | price basis | цінова основа | reviewed (user, 2026-11-15) |
| 41 | `DRAFT_BLOCKED_FIELD_LABELS.flow_basis` | flow basis | основа потоку | reviewed (user, 2026-11-15) |
| 42 | `DRAFT_BLOCKED_FIELD_LABELS.base_period` | base period | базовий період | reviewed (user, 2026-11-15) |
| 43 | `DRAFT_BLOCKED_FIELD_LABELS.frequency` | frequency | періодичність | reviewed (user, 2026-11-15) |
| 44 | `DRAFT_BLOCKED_MESSAGE` | (function) (fields) => `Not drawn together; differing stored fields: ${fields.join(", ")}` | Не показано разом; збережені поля відрізняються: {fields} | reviewed (user, 2026-11-15) |
| 45 | `DRAFT_BROWSE_SUMMARY` | Countries, indicators and other pages | Країни, показники та інші сторінки | reviewed (user, 2026-11-15) |
| 46 | `DRAFT_C1_FIGURE_LABEL` | (function) (name, unit, parts) => `Line chart of ${name}, one line per country, y-axis ${un | Лінійна діаграма: {name}, одна лінія на країну, вісь y: {unit}: {parts}; таблиця під діаграмою містить усі нанесені точки | reviewed (user, 2026-11-15) |
| 47 | `DRAFT_C1_MARKS` | Dashed grey line: a stored aggregate; square marker: the last point of a stale series; hollow marker: an estimate or provisional value | Штрихова сіра лінія: збережений агрегат; квадратний маркер: остання точка застарілого ряду; порожній маркер: оцінка або попереднє значення | reviewed (user, 2026-11-15) |
| 48 | `DRAFT_C2_FIGURE_LABEL` | (function) (name, period, unit) => `Bar chart of ${name}, reference period ${period}, in ${ | Стовпчикова діаграма: {name}, опорний період {period}, у {unit}; один стовпець на країну; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 49 | `DRAFT_C2_MARKS` | Hollow bar: another reference period, with its period in the label; dashed outline: an aggregate, for reference only | Порожній стовпець: інший опорний період, його вказано в підписі; штриховий контур: агрегат, лише для довідки | reviewed (user, 2026-11-15) |
| 50 | `DRAFT_C2_NO_RANK_REFERENCE` | No ranked reference period for this indicator. | Для цього показника немає ранжованого опорного періоду. | reviewed (user, 2026-11-15) |
| 51 | `DRAFT_C2_TABLE_CAPTION` | (function) (name, period) => `${name}: stored value by country, reference period ${period}` | {name}: збережене значення за країнами, опорний період {period} | reviewed (user, 2026-11-15) |
| 52 | `DRAFT_C3_FIGURE_LABEL` | (function) (xName, xUnit, yName, yUnit, period) => `Scatter plot, x-axis ${xName} in ${xUni | Точкова діаграма: вісь x — {xName}, {xUnit}; вісь y — {yName}, {yUnit}; опорний період {period}; одна точка на країну; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 53 | `DRAFT_C3_MARKS` | Labelled dots are the countries in focus; every country with both values is a dot and is listed in the table. | Підписані точки — країни у фокусі; кожна країна з обома значеннями є точкою й наведена в таблиці. | reviewed (user, 2026-11-15) |
| 54 | `DRAFT_C3_NO_COMMON` | No reference period has a stored value of both indicators. | Немає опорного періоду зі збереженим значенням обох показників. | reviewed (user, 2026-11-15) |
| 55 | `DRAFT_C3_TABLE_CAPTION` | (function) (xName, yName, period) => `${xName} and ${yName}: stored values by country, refe | {xName} і {yName}: збережені значення за країнами, опорний період {period} | reviewed (user, 2026-11-15) |
| 56 | `DRAFT_C4_BLANK` | no stored value | немає збереженого значення | reviewed (user, 2026-11-15) |
| 57 | `DRAFT_C4_FIGURE_LABEL` | (function) (name, unit, first, last) => `Heatmap of ${name}, in ${unit}, countries by perio | Теплова карта: {name}, у {unit}, країни за періодами, від {first} до {last}; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 58 | `DRAFT_C4_LEGEND.min` | lowest | найнижче | reviewed (user, 2026-11-15) |
| 59 | `DRAFT_C4_LEGEND.max` | highest | найвище | reviewed (user, 2026-11-15) |
| 60 | `DRAFT_C4_MARKS` | Hatched cell: no stored value | Заштрихована клітинка: немає збереженого значення | reviewed (user, 2026-11-15) |
| 61 | `DRAFT_C4_OUTLINE_MARK` | Dashed outline: a stale row, shown because Show stale rows is on | Штриховий контур: застарілий рядок, показаний, бо ввімкнено «Показувати застарілі рядки» | reviewed (user, 2026-11-15) |
| 62 | `DRAFT_C4_SCALE` | (function) (min, max) => `${min} to ${max}, the lowest and highest cell shown` | від {min} до {max}, найнижча й найвища показані клітинки | reviewed (user, 2026-11-15) |
| 63 | `DRAFT_C4_TABLE_CAPTION` | (function) (name, unit) => `${name}: stored value by country and period, in ${unit}` | {name}: збережене значення за країнами та періодами, у {unit} | reviewed (user, 2026-11-15) |
| 64 | `DRAFT_C6_AGGREGATES_NOTE` | Aggregates and countries outside the map are not drawn; they are listed under the hidden rows and in the table. | Агрегати та країни поза картою не показано; їх наведено серед прихованих рядків і в таблиці. | reviewed (user, 2026-11-15) |
| 65 | `DRAFT_C6_CARD_TITLE` | Map of values | Карта значень | reviewed (user, 2026-11-15) |
| 66 | `DRAFT_C6_FIGURE_LABEL` | (function) (name, period, unit) => `Map of Europe: ${name}, reference period ${period}, in  | Карта Європи: {name}, опорний період {period}, у {unit}; одна фігура на країну; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 67 | `DRAFT_C6_GEO_PENDING` | Loading the map shapes. | Завантаження контурів карти. | reviewed (user, 2026-11-15) |
| 68 | `DRAFT_C6_GEO_UNREADABLE` | The map shapes could not be read, so the map is not drawn; the table lists the same values | Контури карти не вдалося прочитати, тому карту не показано; таблиця містить ті самі значення | reviewed (user, 2026-11-15) |
| 69 | `DRAFT_C6_LEGEND_UNIT` | (function) (unit) => `Unit: ${unit}` | Одиниця: {unit} | reviewed (user, 2026-11-15) |
| 70 | `DRAFT_C6_MARKS` | Hatched: no stored value; plain: a stored value not drawn here; circle: a small country; dashed outline: another reference period | Штриховка: немає збереженого значення; без заливки: збережене значення, яке тут не показано; коло: мала країна; штриховий контур: інший опорний період | reviewed (user, 2026-11-15) |
| 71 | `DRAFT_C6_NOT_MAPPED.aggregate` | an aggregate, not drawn on the map | агрегат, не показаний на карті | reviewed (user, 2026-11-15) |
| 72 | `DRAFT_C6_NOT_MAPPED.outside` | outside the map extent | поза межами карти | reviewed (user, 2026-11-15) |
| 73 | `DRAFT_C6_NOT_MAPPED.nogeometry` | no map shape for this country | для цієї країни немає контуру на карті | reviewed (user, 2026-11-15) |
| 74 | `DRAFT_C6_NOT_MAPPED_SENTENCE` | (function) (why, stored) => `${why}; ${stored}` | {why}; {stored} | reviewed (user, 2026-11-15) |
| 75 | `DRAFT_C6_SCALE` | (function) (min, max) => `${min} to ${max}, the lowest and highest country shown; continuou | від {min} до {max}, найнижча й найвища показані країни; неперервна шкала, без класів | reviewed (user, 2026-11-15) |
| 76 | `DRAFT_C6_SKIP_TO_TABLE` | Skip to the table of map values | Перейти до таблиці значень карти | reviewed (user, 2026-11-15) |
| 77 | `DRAFT_C6_SOURCE_NOTE` | Map shapes: Natural Earth. | Контури карти: Natural Earth. | reviewed (user, 2026-11-15) |
| 78 | `DRAFT_C6_STORED` | (function) (value, period) => `${value} (${period})` | {value} ({period}) | reviewed (user, 2026-11-15) |
| 79 | `DRAFT_C6_TABLE_CAPTION` | (function) (name, period) => `${name}: stored value by country, reference period ${period}, | {name}: збережене значення за країнами, опорний період {period}, як на карті | reviewed (user, 2026-11-15) |
| 80 | `DRAFT_CAPTION_LABELS.indicator` | Indicator | Показник | reviewed (user, 2026-11-15) |
| 81 | `DRAFT_CAPTION_LABELS.unit` | Unit | Одиниця | reviewed (user, 2026-11-15) |
| 82 | `DRAFT_CAPTION_LABELS.frequency` | Frequency | Періодичність | reviewed (user, 2026-11-15) |
| 83 | `DRAFT_CAPTION_LABELS.seasonal` | Seasonal adjustment | Сезонне коригування | reviewed (user, 2026-11-15) |
| 84 | `DRAFT_CAPTION_LABELS.period` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 85 | `DRAFT_CAPTION_LABELS.scale` | Colour scale | Колірна шкала | reviewed (user, 2026-11-15) |
| 86 | `DRAFT_CAPTION_LABELS.source` | Source | Джерело | reviewed (user, 2026-11-15) |
| 87 | `DRAFT_CAPTION_LABELS.vintage` | Vintage | Вінтаж | reviewed (user, 2026-11-15) |
| 88 | `DRAFT_CAPTION_LEGEND.EST` | estimate | оцінка | reviewed (user, 2026-11-15) |
| 89 | `DRAFT_CAPTION_LEGEND.PROV` | provisional | попереднє | reviewed (user, 2026-11-15) |
| 90 | `DRAFT_CAPTION_SEASONAL.SA` | SA | СК | reviewed (user, 2026-11-15) |
| 91 | `DRAFT_CAPTION_SEASONAL.NSA` | NSA | без СК | reviewed (user, 2026-11-15) |
| 92 | `DRAFT_CAPTION_SEASONAL.NA` | not applicable | не застосовується | reviewed (user, 2026-11-15) |
| 93 | `DRAFT_CAPTION_VINTAGE` | (function) (date) => `latest vintage as of ${date}` | остання версія станом на {date} | reviewed (user, 2026-11-15) |
| 94 | `DRAFT_CARD_REVISIONS` | Revisions and vintages | Ревізії та вінтажі | reviewed (user, 2026-11-15) |
| 95 | `DRAFT_CHART_MARKS` | A hollow marker is an estimated or provisional value. A ring around a point is a value that was revised after this system first stored it. A thin vertical line marks the latest observation of a series. A diamond marks an alert and a triangle a watch from the latest analysis run only; the list below the chart gives the level and z for each. | Порожній маркер — оцінене або попереднє значення. Кільце навколо точки — значення, ревізоване після того, як система вперше його зберегла. Тонка вертикальна лінія позначає останнє спостереження ряду. Ромб позначає сповіщення, трикутник — застереження лише за останнім запуском аналізу; список під діаграмою вказує рівень і z для кожного. | reviewed (user, 2026-11-15) |
| 96 | `DRAFT_CHART_MODES.lines` | Lines | Лінії | reviewed (user, 2026-11-15) |
| 97 | `DRAFT_CHART_MODES.bars` | Bars | Стовпці | reviewed (user, 2026-11-15) |
| 98 | `DRAFT_CHART_SHOWS` | Each line is one country's stored values over time; the label at the end of a line gives the country and its latest stored value with the unit. Gaps in a line are periods without a stored value. | Кожна лінія — збережені значення однієї країни в часі; підпис наприкінці лінії містить країну та її останнє збережене значення з одиницею. Розриви в лінії — періоди без збереженого значення. | reviewed (user, 2026-11-15) |
| 99 | `DRAFT_CHART_TYPE_LEGEND` | Chart type | Тип діаграми | reviewed (user, 2026-11-15) |
| 100 | `DRAFT_CHOOSE_COUNTRIES_HINT` | Choose up to 5 countries to compare. | Оберіть до 5 країн для порівняння. | reviewed (user, 2026-11-15) |
| 101 | `DRAFT_CHOOSE_COUNTRY_PLACEHOLDER` | Choose a country to see its key indicators. | Оберіть країну, щоб побачити її ключові показники. | reviewed (user, 2026-11-15) |
| 102 | `DRAFT_COMPARE_CARD_TITLES.c1` | Time series by country | Часові ряди за країнами | reviewed (user, 2026-11-15) |
| 103 | `DRAFT_COMPARE_CARD_TITLES.c2` | Ranked values | Ранжовані значення | reviewed (user, 2026-11-15) |
| 104 | `DRAFT_COMPARE_CARD_TITLES.c3` | Two indicators | Два показники | reviewed (user, 2026-11-15) |
| 105 | `DRAFT_COMPARE_CARD_TITLES.c4` | Countries by period | Країни за періодами | reviewed (user, 2026-11-15) |
| 106 | `DRAFT_COMPARE_CARD_TITLES.c5` | Percentile heatmap | Теплова карта процентилів | reviewed (user, 2026-11-15) |
| 107 | `DRAFT_COMPARE_CARD_TITLES.t2` | Indicator table | Таблиця показників | reviewed (user, 2026-11-15) |
| 108 | `DRAFT_COMPARE_CHOOSE_INDICATOR` | Choose an indicator to compare countries. | Оберіть показник, щоб порівняти країни. | reviewed (user, 2026-11-15) |
| 109 | `DRAFT_COMPARE_CHOOSE_PAIR` | Choose two indicators to compare. | Оберіть два показники для порівняння. | reviewed (user, 2026-11-15) |
| 110 | `DRAFT_COMPARE_CONTROLS_LABEL` | (function) (title) => `Controls: ${title}` | Елементи керування: {title} | reviewed (user, 2026-11-15) |
| 111 | `DRAFT_COMPARE_CONTROL_LABELS.domain` | Domain | Домен | reviewed (user, 2026-11-15) |
| 112 | `DRAFT_COMPARE_CONTROL_LABELS.countries` | Countries | Країни | reviewed (user, 2026-11-15) |
| 113 | `DRAFT_COMPARE_CONTROL_LABELS.x` | X indicator | Показник X | reviewed (user, 2026-11-15) |
| 114 | `DRAFT_COMPARE_CONTROL_LABELS.y` | Y indicator | Показник Y | reviewed (user, 2026-11-15) |
| 115 | `DRAFT_COMPARE_CONTROL_LABELS.p` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 116 | `DRAFT_COMPARE_CONTROL_LABELS.choose` | Choose an indicator | Оберіть показник | reviewed (user, 2026-11-15) |
| 117 | `DRAFT_COMPARE_CONTROL_LABELS.latest` | Default period | Типовий період | reviewed (user, 2026-11-15) |
| 118 | `DRAFT_COMPARE_CONTROL_LABELS.sort` | Sort by | Сортувати за | reviewed (user, 2026-11-15) |
| 119 | `DRAFT_COMPARE_DEFAULT_COUNTRIES` | No country is chosen: the default countries are shown. | Жодної країни не обрано: показано країни за замовчуванням. | reviewed (user, 2026-11-15) |
| 120 | `DRAFT_COMPARE_SECONDARY` | (function) (title) => `Percentile layer: ${title}` | Шар процентилів: {title} | reviewed (user, 2026-11-15) |
| 121 | `DRAFT_COMPARE_SERIES_PENDING` | Loading the series file of this indicator. | Завантаження файлу рядів цього показника. | reviewed (user, 2026-11-15) |
| 122 | `DRAFT_COMPARE_SORTS.value` | Value | Значення | reviewed (user, 2026-11-15) |
| 123 | `DRAFT_COMPARE_SORTS.name` | Country (A to Z) | Країна (А–Я) | reviewed (user, 2026-11-15) |
| 124 | `DRAFT_COMPARE_SORTS.percentile` | Percentile | Процентиль | reviewed (user, 2026-11-15) |
| 125 | `DRAFT_COMPAT_SKIPPED` | (function) (fields) => `Not compared, no stored value: ${fields.join(", ")}` | Не порівнюється, немає збереженого значення: {fields} | reviewed (user, 2026-11-15) |
| 126 | `DRAFT_CONSEQUENCE.lists` | The lists on this page are still shown. | Списки на цій сторінці й далі показано. | reviewed (user, 2026-11-15) |
| 127 | `DRAFT_CONSEQUENCE.scorecard` | The tables and charts on this page are not shown. | Таблиці та діаграми на цій сторінці не показано. | reviewed (user, 2026-11-15) |
| 128 | `DRAFT_CONSEQUENCE.explorer` | The chart and tables on this page are not shown. | Діаграму й таблиці на цій сторінці не показано. | reviewed (user, 2026-11-15) |
| 129 | `DRAFT_CONSEQUENCE.revisions` | The revision lists on this page are not shown. | Списки ревізій на цій сторінці не показано. | reviewed (user, 2026-11-15) |
| 130 | `DRAFT_CONTEXT_LINES` | Context lines | Контекстні лінії | reviewed (user, 2026-11-15) |
| 131 | `DRAFT_COUNTRY_CARD_TITLES.k1` | Latest values | Останні значення | reviewed (user, 2026-11-15) |
| 132 | `DRAFT_COUNTRY_CARD_TITLES.l1` | Time series | Часові ряди | reviewed (user, 2026-11-15) |
| 133 | `DRAFT_COUNTRY_CARD_TITLES.p1` | Position among countries | Позиція серед країн | reviewed (user, 2026-11-15) |
| 134 | `DRAFT_COUNTRY_CARD_TITLES.t1` | Indicator table | Таблиця показників | reviewed (user, 2026-11-15) |
| 135 | `DRAFT_COUNTRY_CARD_TITLES.l2` | Series | Ряди | reviewed (user, 2026-11-15) |
| 136 | `DRAFT_COUNTRY_CHIP_HELP` | Select up to 5 countries. | Оберіть до 5 країн. | reviewed (user, 2026-11-15) |
| 137 | `DRAFT_COUNTRY_COLUMNS.indicator` | Indicator | Показник | reviewed (user, 2026-11-15) |
| 138 | `DRAFT_COUNTRY_COLUMNS.value` | Latest value | Останнє значення | reviewed (user, 2026-11-15) |
| 139 | `DRAFT_COUNTRY_COLUMNS.period` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 140 | `DRAFT_COUNTRY_COLUMNS.percentile` | percentile vs all ranked countries | процентиль серед усіх ранжованих країн | reviewed (user, 2026-11-15) |
| 141 | `DRAFT_COUNTRY_COLUMNS.source` | Source | Джерело | reviewed (user, 2026-11-15) |
| 142 | `DRAFT_COUNTRY_COLUMNS.actions` | Actions | Дії | reviewed (user, 2026-11-15) |
| 143 | `DRAFT_COUNTRY_COLUMNS.reason` | Why there is no value | Чому немає значення | reviewed (user, 2026-11-15) |
| 144 | `DRAFT_COUNTRY_FILTER_ALL` | All indicators | Усі показники | reviewed (user, 2026-11-15) |
| 145 | `DRAFT_COUNTRY_FILTER_LEGEND` | Show | Показати | reviewed (user, 2026-11-15) |
| 146 | `DRAFT_COUNTRY_FILTER_VALUE` | Only indicators with a value | Лише показники зі значенням | reviewed (user, 2026-11-15) |
| 147 | `DRAFT_COUNTRY_GROUPS_LABEL` | Groups | Групи | reviewed (user, 2026-11-15) |
| 148 | `DRAFT_COUNTRY_KIND_LABEL` | Kind | Тип | reviewed (user, 2026-11-15) |
| 149 | `DRAFT_COUNTRY_LIMIT` | (function) (n) => `You can select up to ${n} countries. Clear one to select another.` | Можна обрати до {n} країн. Приберіть одну, щоб обрати іншу. | reviewed (user, 2026-11-15) |
| 150 | `DRAFT_COUNTRY_NO_GROUPS` | none | немає | reviewed (user, 2026-11-15) |
| 151 | `DRAFT_COUNTRY_SELECTED` | (function) (n) => `${n} selected` | Обрано: {n} | reviewed (user, 2026-11-15) |
| 152 | `DRAFT_COUNTRY_SWITCHER_GO` | Go | Перейти | reviewed (user, 2026-11-15) |
| 153 | `DRAFT_COUNTRY_SWITCHER_LABEL` | Switch country | Змінити країну | reviewed (user, 2026-11-15) |
| 154 | `DRAFT_COUNTRY_TABLE_CAPTION` | (function) (domainName, countryName) => `${domainName}: indicators of ${countryName}` | {domainName}: показники країни {countryName} | reviewed (user, 2026-11-15) |
| 155 | `DRAFT_CRUMB_COUNTRIES` | Countries | Країни | reviewed (user, 2026-11-15) |
| 156 | `DRAFT_CRUMB_HOME` | Home | Головна | reviewed (user, 2026-11-15) |
| 157 | `DRAFT_CRUMB_INDICATORS` | Indicators | Показники | reviewed (user, 2026-11-15) |
| 158 | `DRAFT_CRUMB_LABEL` | Breadcrumb | Навігаційний ланцюжок | reviewed (user, 2026-11-15) |
| 159 | `DRAFT_DOMAINS_BAND` | All domains | Усі домени | reviewed (user, 2026-11-15) |
| 160 | `DRAFT_DOWNLOAD` | Download the data file of this indicator | Завантажити файл даних цього показника | reviewed (user, 2026-11-15) |
| 161 | `DRAFT_EMPTY_CARD` | No values for this selection. | Немає значень для цього вибору. | reviewed (user, 2026-11-15) |
| 162 | `DRAFT_ERROR_INVALID` | (function) (region) => `The data of ${region} did not pass the format check, so it is not u | Дані розділу «{region}» не пройшли перевірку формату, тому їх не використано. | reviewed (user, 2026-11-15) |
| 163 | `DRAFT_ERROR_TITLE` | (function) (region) => `Could not load ${region}.` | Не вдалося завантажити: {region}. | reviewed (user, 2026-11-15) |
| 164 | `DRAFT_ERROR_VERSION` | (function) (region) => `This page cannot read ${region}: its data version is not supported  | Ця сторінка не може прочитати розділ «{region}»: версія даних не підтримується цим інтерфейсом. | reviewed (user, 2026-11-15) |
| 165 | `DRAFT_EXPLORER_FIGURE_LABEL` | (function) (title, yLabel, parts) => `Line chart of ${title}, y-axis ${yLabel}. ${parts.joi | Лінійна діаграма: {title}, вісь y: {yLabel}. {parts}. Таблиця під діаграмою містить усі нанесені точки. | reviewed (user, 2026-11-15) |
| 166 | `DRAFT_FACET_COLLAPSE` | Collapse | Згорнути | reviewed (user, 2026-11-15) |
| 167 | `DRAFT_FACET_EXPAND` | Expand | Розгорнути | reviewed (user, 2026-11-15) |
| 168 | `DRAFT_FACET_STATEMENT` | More than 5 countries are selected, so each country has its own chart. | Обрано понад 5 країн, тому кожна країна має власну діаграму. | reviewed (user, 2026-11-15) |
| 169 | `DRAFT_FACT_LABELS.value` | Latest value | Останнє значення | reviewed (user, 2026-11-15) |
| 170 | `DRAFT_FACT_LABELS.refPeriod` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 171 | `DRAFT_FACT_LABELS.refOffset` | Reference offset (days) | Зсув опорного періоду (днів) | reviewed (user, 2026-11-15) |
| 172 | `DRAFT_FACT_LABELS.release` | Source release | Публікація джерела | reviewed (user, 2026-11-15) |
| 173 | `DRAFT_FACT_LABELS.age` | Age (days) | Вік (днів) | reviewed (user, 2026-11-15) |
| 174 | `DRAFT_FACT_LABELS.limit` | Staleness limit (days) | Межа застарілості (днів) | reviewed (user, 2026-11-15) |
| 175 | `DRAFT_FACT_LABELS.flags` | Flags | Позначки | reviewed (user, 2026-11-15) |
| 176 | `DRAFT_FIGURE_COVERAGE` | (function) (nAvailable, nDefined) => `${nAvailable} of ${nDefined} indicators available` | Доступно показників: {nAvailable} з {nDefined} | reviewed (user, 2026-11-15) |
| 177 | `DRAFT_FIGURE_POSITION` | (function) (position, nRanked) => `position ${position} of ${nRanked}` | позиція {position} з {nRanked} | reviewed (user, 2026-11-15) |
| 178 | `DRAFT_FILTER_ALL.countries` | All countries | Усі країни | reviewed (user, 2026-11-15) |
| 179 | `DRAFT_FILTER_ALL.domains` | All domains | Усі домени | reviewed (user, 2026-11-15) |
| 180 | `DRAFT_FILTER_ALL.frequencies` | All frequencies | Усі періодичності | reviewed (user, 2026-11-15) |
| 181 | `DRAFT_FILTER_CHIP_SUMMARY` | (function) (label, value) => `${label}: ${value}` | {label}: {value} | reviewed (user, 2026-11-15) |
| 182 | `DRAFT_FILTER_LABELS.filters` | Filters | Фільтри | reviewed (user, 2026-11-15) |
| 183 | `DRAFT_FILTER_LABELS.group` | Group | Група | reviewed (user, 2026-11-15) |
| 184 | `DRAFT_FILTER_LABELS.country` | Country | Країна | reviewed (user, 2026-11-15) |
| 185 | `DRAFT_FILTER_LABELS.domain` | Domain | Домен | reviewed (user, 2026-11-15) |
| 186 | `DRAFT_FILTER_LABELS.indicator` | Indicator | Показник | reviewed (user, 2026-11-15) |
| 187 | `DRAFT_FILTER_LABELS.period` | Period | Період | reviewed (user, 2026-11-15) |
| 188 | `DRAFT_FILTER_LABELS.frequency` | Frequency | Періодичність | reviewed (user, 2026-11-15) |
| 189 | `DRAFT_FILTER_LABELS.from` | From | Від | reviewed (user, 2026-11-15) |
| 190 | `DRAFT_FILTER_LABELS.to` | To | До | reviewed (user, 2026-11-15) |
| 191 | `DRAFT_FILTER_LABELS.all` | All | Усі | reviewed (user, 2026-11-15) |
| 192 | `DRAFT_FILTER_LABELS.reset` | Reset filters | Скинути фільтри | reviewed (user, 2026-11-15) |
| 193 | `DRAFT_FREE_Y_LABEL` | Free y-axis (used when more than 5 countries are selected) | Вільна вісь y (застосовується, коли обрано понад 5 країн) | reviewed (user, 2026-11-15) |
| 194 | `DRAFT_FREQUENCY_NAMES.D` | Daily | Щоденна | reviewed (user, 2026-11-15) |
| 195 | `DRAFT_FREQUENCY_NAMES.M` | Monthly | Щомісячна | reviewed (user, 2026-11-15) |
| 196 | `DRAFT_FREQUENCY_NAMES.Q` | Quarterly | Щоквартальна | reviewed (user, 2026-11-15) |
| 197 | `DRAFT_FREQUENCY_NAMES.A` | Annual | Щорічна | reviewed (user, 2026-11-15) |
| 198 | `DRAFT_GROUP_BROWSE` | Browse | Огляд | reviewed (user, 2026-11-15) |
| 199 | `DRAFT_GROUP_REFERENCE_ROWS` | Reference rows | Довідкові рядки | reviewed (user, 2026-11-15) |
| 200 | `DRAFT_HEATMAP_CAPTION` | (function) (domainName, label) => `${domainName}: ${label}, and the percentile of each indi | {domainName}: {label} і процентиль кожного показника за країнами | reviewed (user, 2026-11-15) |
| 201 | `DRAFT_HEATMAP_CAPTION_INFO` | (function) (domainName) => `${domainName}: latest value of each indicator, by country (${IN | {domainName}: останнє значення кожного показника за країнами ({INFORMATIONAL_NOTICE}) | reviewed (user, 2026-11-15) |
| 202 | `DRAFT_HIDDEN_LIST_ITEM` | (function) (label, reasonLabel, period, sentence) => `${label}: ${reasonLabel}; latest valu | {label}: {reasonLabel}; останнє значення {period}; {sentence} | reviewed (user, 2026-11-15) |
| 203 | `DRAFT_HIDDEN_REASON_LABELS.no_data` | No data | Немає даних | reviewed (user, 2026-11-15) |
| 204 | `DRAFT_HIDDEN_REASON_LABELS.stale` | Stale | Застаріле | reviewed (user, 2026-11-15) |
| 205 | `DRAFT_HIDDEN_REASON_LABELS.other_period` | Other period | Інший період | reviewed (user, 2026-11-15) |
| 206 | `DRAFT_HIDDEN_REASON_LABELS.other` | Other | Інше | reviewed (user, 2026-11-15) |
| 207 | `DRAFT_HIDDEN_ROWS` | (function) (n) => (n > 1 ? `${n} rows hidden by the period filter` : n === 1 ? "1 row hidde | one: Приховано 1 рядок фільтром періоду; few: Приховано {n} рядки фільтром періоду; many: Приховано {n} рядків фільтром періоду; other: Приховано {n} рядка фільтром періоду | reviewed (user, 2026-11-15) |
| 208 | `DRAFT_HIDDEN_ROW_ITEM` | (function) (name, period) => `${name}: latest value ${period}` | {name}: останнє значення {period} | reviewed (user, 2026-11-15) |
| 209 | `DRAFT_HIDDEN_SUMMARY` | (function) (counts) => {   const parts = Object.keys(HIDDEN_PARTS).filter((k) => counts?.[k | one: Приховано {n} рядок: {parts}; few: Приховано {n} рядки: {parts}; many: Приховано {n} рядків: {parts}; other: Приховано {n} рядка: {parts} | reviewed (user, 2026-11-15) |
| 210 | `DRAFT_HISTORY_CONSEQUENCE` | No history chart is shown for this indicator. | Діаграму історії для цього показника не показано. | reviewed (user, 2026-11-15) |
| 211 | `DRAFT_HISTORY_FIGURE_LABEL` | (function) (indicatorName, countryName, unit) => `history of ${indicatorName} for ${country | історія показника «{indicatorName}» для {countryName}, у {unit}; таблиця нижче містить останні значення | reviewed (user, 2026-11-15) |
| 212 | `DRAFT_HISTORY_HIDE` | Hide history | Сховати історію | reviewed (user, 2026-11-15) |
| 213 | `DRAFT_HISTORY_REGION` | the history of this indicator | історія цього показника | reviewed (user, 2026-11-15) |
| 214 | `DRAFT_HISTORY_SHOW` | Show history | Показати історію | reviewed (user, 2026-11-15) |
| 215 | `DRAFT_HISTORY_TABLE_TITLE` | (function) (indicatorName, countryName) => `${indicatorName}: ${countryName}` | {indicatorName}: {countryName} | reviewed (user, 2026-11-15) |
| 216 | `DRAFT_HOME_DOMAINS_TITLE` | Domains | Домени (alias of HOME_LINKS.domains) | reviewed (user, 2026-11-15) |
| 217 | `DRAFT_HOME_FILTER_COUNT` | (function) (n) => `${n} shown` | показано: {n} | reviewed (user, 2026-11-15) |
| 218 | `DRAFT_HOME_FILTER_NONE` | No match. | Нічого не знайдено. | reviewed (user, 2026-11-15) |
| 219 | `DRAFT_HOME_H1` | Macro dashboard | Макроекономічна панель | reviewed (user, 2026-11-15) |
| 220 | `DRAFT_INCLUDE_OTHER_PERIODS` | Include rows from other reference periods | Включити рядки з інших опорних періодів | reviewed (user, 2026-11-15) |
| 221 | `DRAFT_INDICATOR_COLUMNS.country` | Country | Країна | reviewed (user, 2026-11-15) |
| 222 | `DRAFT_INDICATOR_COLUMNS.value` | Latest value | Останнє значення | reviewed (user, 2026-11-15) |
| 223 | `DRAFT_INDICATOR_COLUMNS.period` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 224 | `DRAFT_INDICATOR_COLUMNS.offset` | Offset (days) | Зсув (днів) | reviewed (user, 2026-11-15) |
| 225 | `DRAFT_INDICATOR_COLUMNS.percentile` | percentile vs all ranked countries | процентиль серед усіх ранжованих країн | reviewed (user, 2026-11-15) |
| 226 | `DRAFT_INDICATOR_COLUMNS_MORE.flags` | Flags | Позначки | reviewed (user, 2026-11-15) |
| 227 | `DRAFT_INDICATOR_COLUMNS_MORE.source` | Source | Джерело | reviewed (user, 2026-11-15) |
| 228 | `DRAFT_INDICATOR_COLUMNS_MORE.actions` | Actions | Дії | reviewed (user, 2026-11-15) |
| 229 | `DRAFT_INDICATOR_COLUMNS_MORE.reason` | Why there is no value | Чому немає значення | reviewed (user, 2026-11-15) |
| 230 | `DRAFT_INDICATOR_FACT_LABELS.id` | Identifier | Ідентифікатор | reviewed (user, 2026-11-15) |
| 231 | `DRAFT_INDICATOR_FACT_LABELS.domains` | Domains | Домени | reviewed (user, 2026-11-15) |
| 232 | `DRAFT_INDICATOR_FACT_LABELS.unit` | Unit | Одиниця | reviewed (user, 2026-11-15) |
| 233 | `DRAFT_INDICATOR_FACT_LABELS.frequency` | Frequency | Періодичність | reviewed (user, 2026-11-15) |
| 234 | `DRAFT_INDICATOR_FACT_LABELS.direction` | Direction | Напрям | reviewed (user, 2026-11-15) |
| 235 | `DRAFT_INDICATOR_FACT_LABELS.notes` | Notes | Примітки | reviewed (user, 2026-11-15) |
| 236 | `DRAFT_INDICATOR_FACT_LABELS.transform` | Transform | Перетворення | reviewed (user, 2026-11-15) |
| 237 | `DRAFT_INDICATOR_SORT_LABEL` | Sort by | Сортувати за | reviewed (user, 2026-11-15) |
| 238 | `DRAFT_INDICATOR_SORT_LABELS.name` | Country | Країна | reviewed (user, 2026-11-15) |
| 239 | `DRAFT_INDICATOR_SORT_LABELS.value` | Value | Значення | reviewed (user, 2026-11-15) |
| 240 | `DRAFT_INDICATOR_SORT_LABELS.percentile` | Percentile | Процентиль | reviewed (user, 2026-11-15) |
| 241 | `DRAFT_INDICATOR_SORT_LABELS.period` | Reference period | Опорний період | reviewed (user, 2026-11-15) |
| 242 | `DRAFT_INDICATOR_SWITCHER_GO` | Go | Перейти | reviewed (user, 2026-11-15) |
| 243 | `DRAFT_INDICATOR_TABLE_CAPTION` | (function) (indicatorName) => `${indicatorName}: latest values by country` | {indicatorName}: останні значення за країнами | reviewed (user, 2026-11-15) |
| 244 | `DRAFT_KPI_ERROR_CONSEQUENCE` | The key indicators are not shown. | Ключові показники не показано. | reviewed (user, 2026-11-15) |
| 245 | `DRAFT_L1_SUMMARY` | (function) (domainName) => `${domainName}: time series` | {domainName}: часові ряди | reviewed (user, 2026-11-15) |
| 246 | `DRAFT_LEGEND_BINS` | Percentile bins | Інтервали процентилів | reviewed (user, 2026-11-15) |
| 247 | `DRAFT_LEGEND_STATES` | Cell marks | Позначки клітинок | reviewed (user, 2026-11-15) |
| 248 | `DRAFT_LEGEND_TITLE` | Legend | Легенда | reviewed (user, 2026-11-15) |
| 249 | `DRAFT_LOADING` | (function) (what) => `Loading ${what}...` | Завантаження: {what}... | reviewed (user, 2026-11-15) |
| 250 | `DRAFT_LOAD_HISTORY` | Load history | Завантажити історію | reviewed (user, 2026-11-15) |
| 251 | `DRAFT_MARKED_SEASONAL` | Mixes SA and NSA series | Поєднує ряди з СК і без СК | reviewed (user, 2026-11-15) |
| 252 | `DRAFT_MODE_LABELS.country` | Country | Країна | reviewed (user, 2026-11-15) |
| 253 | `DRAFT_MODE_LABELS.compare` | Compare | Порівняння | reviewed (user, 2026-11-15) |
| 254 | `DRAFT_MODE_SWITCH_LABEL` | Mode | Режим | reviewed (user, 2026-11-15) |
| 255 | `DRAFT_NA_DEFINED_SENTENCE` | A series is defined for this country, but this export holds no value for it. | Ряд для цієї країни визначено, але в цьому експорті немає його значення. | reviewed (user, 2026-11-15) |
| 256 | `DRAFT_NA_NO_PERCENTILE_SENTENCE` | This export holds a value but no percentile for it. | У цьому експорті є значення, але немає його процентиля. | reviewed (user, 2026-11-15) |
| 257 | `DRAFT_NA_NO_RANKED_SENTENCE` | No indicator of this domain has a ranked value for this country. | Жоден показник цього домену не має ранжованого значення для цієї країни. | reviewed (user, 2026-11-15) |
| 258 | `DRAFT_NEXT_GROUP` | Choose another group or another indicator. | Оберіть іншу групу або інший показник. | reviewed (user, 2026-11-15) |
| 259 | `DRAFT_NEXT_SERIES` | Choose at least one country, or another indicator or range. | Оберіть щонайменше одну країну або інший показник чи діапазон. | reviewed (user, 2026-11-15) |
| 260 | `DRAFT_NOSCRIPT` | This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page. | Для показу таблиць і діаграм цій панелі потрібен JavaScript. Увімкніть JavaScript і перезавантажте сторінку. | reviewed (user, 2026-11-15) |
| 261 | `DRAFT_NOT_PUBLISHED_SENTENCE` | Not published on this site. | Не опубліковано на цьому сайті. | reviewed (user, 2026-11-15) |
| 262 | `DRAFT_NOT_STATED` | not stated | не зазначено | reviewed (user, 2026-11-15) |
| 263 | `DRAFT_NO_ALIGNED` | No aligned values for this selection | Немає узгоджених значень для цього вибору | reviewed (user, 2026-11-15) |
| 264 | `DRAFT_NO_VALUE_FOR` | (function) (names) => `no value for ${names.join(", ")}` | немає значення для: {names} | reviewed (user, 2026-11-15) |
| 265 | `DRAFT_OFFSET_FLAG` | (function) (days) => `offset ${days} days` | зсув {days} дн. | reviewed (user, 2026-11-15) |
| 266 | `DRAFT_OPEN_AS_SERIES` | Open as time series | Відкрити як часовий ряд | reviewed (user, 2026-11-15) |
| 267 | `DRAFT_P1A_AGGREGATES_NOTE` | Dashed lines mark the stored value of an aggregate, for reference only. | Штрихові лінії позначають збережене значення агрегату, лише для довідки. | reviewed (user, 2026-11-15) |
| 268 | `DRAFT_P1A_FIGURE_LABEL` | (function) (indicatorName, period, unit) => `Strip plot of ${indicatorName}, reference peri | Точкова смуга: {indicatorName}, опорний період {period}, у {unit}; кожна країна — одна точка; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 269 | `DRAFT_P1A_MARKS` | Ring: the country in focus; hollow dot: an estimate or a value of another reference period | Кільце: країна у фокусі; порожня точка: оцінка або значення іншого опорного періоду | reviewed (user, 2026-11-15) |
| 270 | `DRAFT_P1A_NO_REFERENCE` | The scorecard states no reference period for this indicator. | Таблиця показників не вказує опорний період для цього показника. | reviewed (user, 2026-11-15) |
| 271 | `DRAFT_P1A_REFERENCE` | (function) (period) => `Reference period: ${period}` | Опорний період: {period} | reviewed (user, 2026-11-15) |
| 272 | `DRAFT_P1A_TABLE_CAPTION` | (function) (indicatorName, period) => `${indicatorName}: latest stored value by country, re | {indicatorName}: останнє збережене значення за країнами, опорний період {period} | reviewed (user, 2026-11-15) |
| 273 | `DRAFT_PEER_DIRECTION` | (function) (directionText) => `Direction of this indicator: ${directionText}.` | Напрям цього показника: {directionText}. | reviewed (user, 2026-11-15) |
| 274 | `DRAFT_PEER_FIGURE_LABEL` | (function) (indicatorName, n, column) => `Dot plot of the ${column} for ${indicatorName}, $ | Точкова діаграма: {column} для {indicatorName}, {count}. Таблиця нижче містить ті самі значення. | reviewed (user, 2026-11-15) |
| 275 | `DRAFT_PEER_FOCUS_HINT` | Select a country name to highlight it in the chart and the table; select it again to clear. | Оберіть назву країни, щоб виділити її на діаграмі й у таблиці; оберіть ще раз, щоб зняти виділення. | reviewed (user, 2026-11-15) |
| 276 | `DRAFT_PEER_GUIDES` | The grey lines mark 0.25, 0.5 and 0.75 on the scale. | Сірі лінії позначають 0,25, 0,5 і 0,75 на шкалі. | reviewed (user, 2026-11-15) |
| 277 | `DRAFT_PEER_MARKS` | Filled dot: value observed for this country. Hollow dot: estimated or inherited value. The ring marks the country in focus. | Заповнена точка: значення, спостережене для цієї країни. Порожня точка: оцінене або успадковане значення. Кільце позначає країну у фокусі. | reviewed (user, 2026-11-15) |
| 278 | `DRAFT_PEER_NOT_DRAWN` | A country without a stored percentile (lagging, unaligned, stale or not ranked) is listed in the table only. | Країна без збереженого процентиля (відстає, не узгоджена, застаріла або не ранжується) наведена лише в таблиці. | reviewed (user, 2026-11-15) |
| 279 | `DRAFT_PEER_TABLE_CAPTION` | (function) (indicatorName) => `${indicatorName}: latest value and stored percentile, by cou | {indicatorName}: останнє значення та збережений процентиль за країнами | reviewed (user, 2026-11-15) |
| 280 | `DRAFT_PERIOD_INVALID` | The From year must not be after the To year. The period was not changed. | Рік «Від» не може бути пізнішим за рік «До». Період не змінено. | reviewed (user, 2026-11-15) |
| 281 | `DRAFT_PERIOD_PRESETS.all` | All | Усі | reviewed (user, 2026-11-15) |
| 282 | `DRAFT_PERIOD_PRESETS.last10` | Last 10 years | Останні 10 років | reviewed (user, 2026-11-15) |
| 283 | `DRAFT_PERIOD_PRESETS.last5` | Last 5 years | Останні 5 років | reviewed (user, 2026-11-15) |
| 284 | `DRAFT_PERIOD_REGION` | the period range | діапазон періоду | reviewed (user, 2026-11-15) |
| 285 | `DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE` | The period filter is not available; all years are shown. | Фільтр періоду недоступний; показано всі роки. | reviewed (user, 2026-11-15) |
| 286 | `DRAFT_PERIOD_VALUE` | (function) (from, to) => `${from} to ${to}` | від {from} до {to} | reviewed (user, 2026-11-15) |
| 287 | `DRAFT_PICKER_LABELS.country` | Country | Країна | reviewed (user, 2026-11-15) |
| 288 | `DRAFT_PICKER_LABELS.group` | Group | Група | reviewed (user, 2026-11-15) |
| 289 | `DRAFT_PICKER_LABELS.countries` | Countries | Країни | reviewed (user, 2026-11-15) |
| 290 | `DRAFT_PICKER_LABELS.aggregates` | Aggregates | Агрегати | reviewed (user, 2026-11-15) |
| 291 | `DRAFT_PICKER_LABELS.placeholder` | Choose a country | Оберіть країну | reviewed (user, 2026-11-15) |
| 292 | `DRAFT_PRINT_FILTERS` | (function) (parts) => `Filters: ${parts.length ? parts.join("; ") : "none"}` | Фільтри: {parts} (empty: немає) | reviewed (user, 2026-11-15) |
| 293 | `DRAFT_PROFILE_DOT_LABEL` | (function) (name, percentileText) => `${name}: ${percentileText}` | {name}: {percentileText} | reviewed (user, 2026-11-15) |
| 294 | `DRAFT_PROFILE_FIGURE_LABEL` | (function) (countryName, domainName) => `percentile of each indicator for ${countryName}, d | процентиль кожного показника для {countryName}, домен {domainName}; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 295 | `DRAFT_RANK_COLUMNS.bar` | Bar | Стовпець | reviewed (user, 2026-11-15) |
| 296 | `DRAFT_RANK_COLUMNS.dot` | Percentile position | Позиція процентиля | reviewed (user, 2026-11-15) |
| 297 | `DRAFT_RANK_SORT_LABELS.name` | Country (A to Z) | Країна (А–Я) | reviewed (user, 2026-11-15) |
| 298 | `DRAFT_RANK_SORT_LABELS.value` | Value | Значення | reviewed (user, 2026-11-15) |
| 299 | `DRAFT_RANK_SORT_LABELS.percentile` | Percentile | Процентиль | reviewed (user, 2026-11-15) |
| 300 | `DRAFT_REBASE_MARKS` | The grey lines mark the index value 100 and the base period. | Сірі лінії позначають значення індексу 100 і базовий період. | reviewed (user, 2026-11-15) |
| 301 | `DRAFT_REBASE_STATEMENT` | (function) (period) => `Index, ${period} = 100, rebased for display; stored values unchange | Індекс, {period} = 100, перебазовано лише для показу; збережені значення не змінено. | reviewed (user, 2026-11-15) |
| 302 | `DRAFT_REESTIMATED_MARK` | re-estimated | переоцінено | reviewed (user, 2026-11-15) |
| 303 | `DRAFT_REGIONS.manifest` | the data manifest | маніфест даних | reviewed (user, 2026-11-15) |
| 304 | `DRAFT_REGIONS.meta` | the descriptions of countries, indicators and series | описи країн, показників і рядів | reviewed (user, 2026-11-15) |
| 305 | `DRAFT_REGIONS.scorecard` | the scorecard of this domain | таблиця показників цього домену | reviewed (user, 2026-11-15) |
| 306 | `DRAFT_REGIONS.domains` | the list of domains | список доменів | reviewed (user, 2026-11-15) |
| 307 | `DRAFT_REGIONS.alerts` | the current alerts | поточні сповіщення | reviewed (user, 2026-11-15) |
| 308 | `DRAFT_REGIONS.recent` | the list of recent revisions | список останніх ревізій | reviewed (user, 2026-11-15) |
| 309 | `DRAFT_REGIONS.series` | the series file of this indicator | файл рядів цього показника | reviewed (user, 2026-11-15) |
| 310 | `DRAFT_REGIONS.revisionFile` | the revision file of this indicator | файл ревізій цього показника | reviewed (user, 2026-11-15) |
| 311 | `DRAFT_REGIONS.loadingData` | the dashboard data | дані панелі | reviewed (user, 2026-11-15) |
| 312 | `DRAFT_REGIONS.loadingSeries` | the series of this indicator | ряди цього показника | reviewed (user, 2026-11-15) |
| 313 | `DRAFT_REGIONS.loadingRevisions` | the revision history of this indicator | історія ревізій цього показника | reviewed (user, 2026-11-15) |
| 314 | `DRAFT_REVISIONS_LINK_LABEL` | (function) (indicatorName) => `Revisions of ${indicatorName}` | Ревізії: {indicatorName} | reviewed (user, 2026-11-15) |
| 315 | `DRAFT_SCROLL_HINT` | Scroll sideways to see more indicators. | Прокрутіть вбік, щоб побачити більше показників. | reviewed (user, 2026-11-15) |
| 316 | `DRAFT_SELECT_GROUP` | Select group | Обрати групу | reviewed (user, 2026-11-15) |
| 317 | `DRAFT_SERIES_LABEL_PART` | (function) (name, from, to, latestText) => `${name}, ${from} to ${to}, latest stored value  | {name}, від {from} до {to}, останнє збережене значення {latestText} | reviewed (user, 2026-11-15) |
| 318 | `DRAFT_SERIES_UNREADABLE` | The series file of this indicator could not be read. | Файл рядів цього показника не вдалося прочитати. | reviewed (user, 2026-11-15) |
| 319 | `DRAFT_SHOW_MORE` | Show more | Показати більше | reviewed (user, 2026-11-15) |
| 320 | `DRAFT_SHOW_PERCENTILE` | Show percentile | Показувати процентиль | reviewed (user, 2026-11-15) |
| 321 | `DRAFT_SHOW_STALE` | Show stale rows | Показувати застарілі рядки | reviewed (user, 2026-11-15) |
| 322 | `DRAFT_SPARKLINE_TOO_FEW` | Too few values in the selected period. | Замало значень у вибраному періоді. | reviewed (user, 2026-11-15) |
| 323 | `DRAFT_STALE_CODE` | stale | застаріле | reviewed (user, 2026-11-15) |
| 324 | `DRAFT_STALE_PERIOD` | (function) (period) => `stale, ${period}` | застаріле, {period} | reviewed (user, 2026-11-15) |
| 325 | `DRAFT_STALE_TIP` | (function) (period) => `stale, latest stored period ${period}` | застаріле, останній збережений період {period} | reviewed (user, 2026-11-15) |
| 326 | `DRAFT_STATE_COLUMN` | State | Стан | reviewed (user, 2026-11-15) |
| 327 | `DRAFT_STEP_CHOOSE_PERIOD` | Choose one reference period to see its step chart. | Оберіть один опорний період, щоб побачити його ступінчасту діаграму. | reviewed (user, 2026-11-15) |
| 328 | `DRAFT_STEP_FIGURE_LABEL` | (function) (title, country, period, yLabel, parts) => `Step chart of ${title} for ${country | Ступінчаста діаграма: {title} для {country}, опорний період {period}, вісь y: {yLabel}. {parts}. Таблиця версій нижче містить ті самі точки. | reviewed (user, 2026-11-15) |
| 329 | `DRAFT_STEP_FIGURE_PART` | (function) (known, valueText) => `${known}: ${valueText}` | {known}: {valueText} | reviewed (user, 2026-11-15) |
| 330 | `DRAFT_STEP_NOTE` | Each step is a stored version, drawn from the day it was known. The hollow point is the earliest stored version. A cross marks a removal. | Кожен крок — збережена версія, намальована від дня, коли вона стала відомою. Порожня точка — найраніша збережена версія. Хрестик позначає вилучення. | reviewed (user, 2026-11-15) |
| 331 | `DRAFT_STEP_REMOVED` | removed | вилучено | reviewed (user, 2026-11-15) |
| 332 | `DRAFT_STEP_SKIP` | Skip to version table | Перейти до таблиці версій | reviewed (user, 2026-11-15) |
| 333 | `DRAFT_SUBREGION_CONSEQUENCE` | The rest of this page is still shown. Choose another indicator to try again. | Решту сторінки й далі показано. Оберіть інший показник, щоб спробувати ще раз. | reviewed (user, 2026-11-15) |
| 334 | `DRAFT_TABLE_CAPTION` | (function) (title, n) => `${title}: plotted values, latest ${n} periods of each series` | {title}: нанесені значення, останні періоди кожного ряду (кількість: {n}) | reviewed (user, 2026-11-15) |
| 335 | `DRAFT_TABLE_CAPTION_ALL` | (function) (title) => `${title}: plotted values, every plotted period of each series` | {title}: нанесені значення, кожен нанесений період кожного ряду | reviewed (user, 2026-11-15) |
| 336 | `DRAFT_TABLE_HEADERS.value` | Value | Значення | reviewed (user, 2026-11-15) |
| 337 | `DRAFT_TABLE_HEADERS.status` | Status | Статус | reviewed (user, 2026-11-15) |
| 338 | `DRAFT_TITLE_UNIT` | (function) (unit) => ` (${unit})` |  ({unit}) | reviewed (user, 2026-11-15) |
| 339 | `DRAFT_TRANSFORMED_HEADER` | (function) (transformLabel) => `Transformed value (${transformLabel})` | Перетворене значення ({transformLabel}) | reviewed (user, 2026-11-15) |
| 340 | `DRAFT_UNIT_MISSING_SENTENCE` | This export holds no unit for this value. | У цьому експорті немає одиниці для цього значення. | reviewed (user, 2026-11-15) |
| 341 | `DRAFT_VALUE_AXIS_TITLE` | (function) (indicatorName, unit) => `${indicatorName} (${unit \|\| DRAFT_UNIT_MISSING_SENTENC | {indicatorName} ({unit}) | reviewed (user, 2026-11-15) |
| 342 | `DRAFT_VALUE_ESTIMATE_MARK` | e | о | reviewed (user, 2026-11-15) |
| 343 | `DRAFT_VALUE_FIGURE_LABEL` | (function) (indicatorName, unit, n) => `Bar chart of ${indicatorName}, ${unit ? `in ${unit} | Стовпчикова діаграма: {indicatorName}, {unitPhrase}, {count}; таблиця нижче містить ті самі значення | reviewed (user, 2026-11-15) |
| 344 | `DRAFT_VALUE_HEADER_UNIT` | (function) (unit) => `Value (${unit})` | Значення ({unit}) | reviewed (user, 2026-11-15) |
| 345 | `DRAFT_VALUE_NEUTRAL_LEGEND` | No percentile | Немає процентиля | reviewed (user, 2026-11-15) |
| 346 | `DRAFT_WITHOUT_VALUE_GROUP` | Indicators without a value in this export | Показники без значення в цьому експорті | reviewed (user, 2026-11-15) |
| 347 | `DRAFT_Y_MODE` | (function) (free) => (free   ? "Each chart has its own y-axis scale: the shape of a series  | free: Кожна діаграма має власну шкалу осі y: форму ряду легко побачити, але рівні між діаграмами порівнювати не можна.; shared: Усі діаграми мають спільну шкалу осі y, тому рівні країн можна порівнювати. | reviewed (user, 2026-11-15) |

## Other strings (confirmed or earlier wording; Ukrainian machine-proposed)

The English text of these entries is the wording confirmed in earlier gates or a fixed statement; the Ukrainian column is proposed only. Plural and helper keys added by V44 are included (plural keys are shown by their base key).

| # | Key | English | Ukrainian | Status |
|---|---|---|---|---|
| 1 | `AGGREGATE_NOT_RANKED` | aggregate (not ranked) | агрегат (не ранжується) | reviewed (user, 2026-11-15) |
| 2 | `AHEAD_NAME` | ranked at its latest value, ahead of the common period | ранжовано за останнім значенням, яке випереджає спільний період | reviewed (user, 2026-11-15) |
| 3 | `AHEAD_TAG` | ahead | випереджає | reviewed (user, 2026-11-15) |
| 4 | `ALERTS_HEADING` | Current alerts (latest run only) | Поточні сповіщення (лише останній запуск) | reviewed (user, 2026-11-15) |
| 5 | `ALERT_LEVEL_PREFIX` | alert level:  | рівень сповіщення:  | reviewed (user, 2026-11-15) |
| 6 | `ALERT_NOT_DRAWN` |  (not drawn: no plotted value at that period) |  (не показано: немає значення на цей період) | reviewed (user, 2026-11-15) |
| 7 | `ALL_LABEL` | All countries | Усі країни | reviewed (user, 2026-11-15) |
| 8 | `ALL_PERIODS` | All reference periods | Усі опорні періоди | reviewed (user, 2026-11-15) |
| 9 | `BIN_LABELS.0` | lowest fifth of the panel | найнижча п’ята частина вибірки | reviewed (user, 2026-11-15) |
| 10 | `BIN_LABELS.1` | second fifth of the panel | друга п’ята частина вибірки | reviewed (user, 2026-11-15) |
| 11 | `BIN_LABELS.2` | middle fifth of the panel | середня п’ята частина вибірки | reviewed (user, 2026-11-15) |
| 12 | `BIN_LABELS.3` | fourth fifth of the panel | четверта п’ята частина вибірки | reviewed (user, 2026-11-15) |
| 13 | `BIN_LABELS.4` | highest fifth of the panel | найвища п’ята частина вибірки | reviewed (user, 2026-11-15) |
| 14 | `CAVEAT` | Percentiles are relative position in the covered panel, not a judgement of structural quality. | Процентилі показують відносну позицію в охопленій вибірці, а не оцінку структурної якості. | reviewed (user, 2026-11-15) |
| 15 | `CHOOSE_INDICATOR_OPTION` | choose an indicator | оберіть показник | reviewed (user, 2026-11-15) |
| 16 | `CLASS_LABEL.regular` | regular | звичайні | reviewed (user, 2026-11-15) |
| 17 | `CLASS_LABEL.reestimation` | re-estimation | переоцінка | reviewed (user, 2026-11-15) |
| 18 | `COMPARE_COUNTRIES` | Compare countries | Порівняння країн | reviewed (user, 2026-11-15) |
| 19 | `COMPARE_COUNTRIES_LABEL` | Compare countries: {indicatorName} | Порівняння країн: {indicatorName} | reviewed (user, 2026-11-15) |
| 20 | `COUNTRY_HEADER` | Country | Країна | reviewed (user, 2026-11-15) |
| 21 | `COVERAGE_HEADER` | Indicators available (n/N) | Доступні показники (n/N) | reviewed (user, 2026-11-15) |
| 22 | `DESCRIPTIVE_CELL` | descriptive, not ranked | описовий, не ранжується | reviewed (user, 2026-11-15) |
| 23 | `DETAILS_SUMMARY` | Values and reference periods | Значення та опорні періоди | reviewed (user, 2026-11-15) |
| 24 | `DIRECTION_LABELS.higher` | higher is better | більше — краще | reviewed (user, 2026-11-15) |
| 25 | `DIRECTION_LABELS.lower` | lower is better | менше — краще | reviewed (user, 2026-11-15) |
| 26 | `DIRECTION_LABELS.target` | closer to target is better | ближче до цільового значення — краще | reviewed (user, 2026-11-15) |
| 27 | `DIRECTION_LABELS.descriptive` | descriptive, not ranked | описовий, не ранжується | reviewed (user, 2026-11-15) |
| 28 | `DOMAIN_FIGURE_LABEL` | mean percentile of the domain's indicators | середній процентиль показників домену | reviewed (user, 2026-11-15) |
| 29 | `DRAFT_HOME_CONTROLS_LABEL` | Controls: Home panels | Елементи керування: панелі головної сторінки | reviewed (user, 2026-11-15) |
| 30 | `DRAFT_HOME_COUNTRY_LABEL` | Open a country | Відкрити країну | reviewed (user, 2026-11-15) |
| 31 | `DRAFT_HOME_KPI_FOR` | Latest stored value for {name} | Останнє збережене значення: {name} | reviewed (user, 2026-11-15) |
| 32 | `DRAFT_HOME_KPI_NOT_LOADED` | The scorecard of this indicator could not be read. | Таблицю показників цього показника не вдалося прочитати. | reviewed (user, 2026-11-15) |
| 33 | `DRAFT_HOME_KPI_NO_VALUE` | No stored value for this entity in this export. | У цьому експорті немає збереженого значення для цієї одиниці. | reviewed (user, 2026-11-15) |
| 34 | `DRAFT_HOME_KPI_TITLE` | Key indicators | Ключові показники | reviewed (user, 2026-11-15) |
| 35 | `DRAFT_HOME_MISSING_ITEM` | {constant}: {id} is not in the stored lists, so it is left out | {constant}: ідентифікатора {id} немає в збережених списках, тому його пропущено | reviewed (user, 2026-11-15) |
| 36 | `DRAFT_HOME_MISSING_SUMMARY` | Some Home settings name an id this export does not carry | Деякі налаштування головної сторінки називають ідентифікатор, якого немає в цьому експорті | reviewed (user, 2026-11-15) |
| 37 | `DRAFT_HOME_MODE_LABEL` | Mode | Режим | reviewed (user, 2026-11-15) |
| 38 | `DRAFT_HOME_PANELS_LABEL` | Comparison panels | Панелі порівняння | reviewed (user, 2026-11-15) |
| 39 | `DRAFT_HOME_PANEL_TITLES.c2` | Ranked values | Ранжовані значення | reviewed (user, 2026-11-15) |
| 40 | `DRAFT_HOME_PANEL_TITLES.c1` | Time series by country | Часові ряди за країнами | reviewed (user, 2026-11-15) |
| 41 | `DRAFT_HOME_PANEL_TITLES.c6` | Map of values | Карта значень | reviewed (user, 2026-11-15) |
| 42 | `DRAFT_HOME_PANEL_TITLES.c4` | Countries by period | Країни за періодами | reviewed (user, 2026-11-15) |
| 43 | `DRAFT_HOME_SCORECARD_PENDING` | Loading the stored values. | Завантаження збережених значень. | reviewed (user, 2026-11-15) |
| 44 | `EARLIEST_LABEL` | earliest stored version | найраніша збережена версія | reviewed (user, 2026-11-15) |
| 45 | `EDITIONS_INTRO` | A named edition (for example an IMF WEO release) can rebase history for thousands of keys at once, so it is shown as one line and never ranked among the ordinary revisions. | Названий випуск (наприклад, публікація МВФ WEO) може перебазувати історію для тисяч ключів одночасно, тому його показано одним рядком і ніколи не ранжовано серед звичайних ревізій. | reviewed (user, 2026-11-15) |
| 46 | `EMPTY_GROUP` | No countries of this group have a value for this indicator in this domain. | Жодна країна цієї групи не має значення цього показника в цьому домені. | reviewed (user, 2026-11-15) |
| 47 | `ESTIMATE_MARK` | e | о | reviewed (user, 2026-11-15) |
| 48 | `FILTER_NOTE` | The group filter only filters and sorts the list. Every percentile shown is the percentile vs all ranked countries; it is not recomputed within the group. | Фільтр групи лише відбирає та сортує список. Кожен показаний процентиль — це процентиль серед усіх ранжованих країн; усередині групи його не перераховують. | reviewed (user, 2026-11-15) |
| 49 | `FLAG_AHEAD` | ahead | випереджає | reviewed (user, 2026-11-15) |
| 50 | `FLAG_ESTIMATE` | estimate | оцінка | reviewed (user, 2026-11-15) |
| 51 | `FLAG_INHERITED` | inherited from the euro area | успадковано від єврозони | reviewed (user, 2026-11-15) |
| 52 | `FLAG_LAGGING` | lagging | відстає | reviewed (user, 2026-11-15) |
| 53 | `FLAG_LOW_COVERAGE` | low coverage | низьке охоплення | reviewed (user, 2026-11-15) |
| 54 | `FLAG_UNALIGNED` | unaligned | не узгоджено | reviewed (user, 2026-11-15) |
| 55 | `FLAG_UNALIGNED_FISCAL` | unaligned (fiscal-year basis) | не узгоджено (за фіскальним роком) | reviewed (user, 2026-11-15) |
| 56 | `FRESHNESS_LABEL` | Data cut-off | Дата відсікання даних | reviewed (user, 2026-11-15) |
| 57 | `GROUP_LABELS.g7` | G7 | G7 | reviewed (user, 2026-11-15) |
| 58 | `GROUP_LABELS.euro_area` | Euro area | Єврозона | reviewed (user, 2026-11-15) |
| 59 | `GROUP_LABELS.non_euro_eu` | EU members outside the euro area | Країни ЄС поза єврозоною | reviewed (user, 2026-11-15) |
| 60 | `GROUP_LABELS.advanced` | Advanced economies | Розвинені економіки | reviewed (user, 2026-11-15) |
| 61 | `GROUP_LABELS.emerging` | Emerging economies | Економіки, що розвиваються | reviewed (user, 2026-11-15) |
| 62 | `G_STR1_NO_SERIES` | This export lists no series for this country and indicator. | Цей експорт не містить рядів для цієї країни та показника. | reviewed (user, 2026-11-15) |
| 63 | `HASH_FALLBACK_NOTE` | Part of this link was not recognised and was ignored. | Частину цього посилання не розпізнано й проігноровано. | reviewed (user, 2026-11-15) |
| 64 | `HASH_NO_ROWS_NOTE` | Not selected: this export has no values of this indicator for {names}. | Не обрано: цей експорт не має значень цього показника для: {names}. | reviewed (user, 2026-11-15) |
| 65 | `HEATMAP_INDICATOR_LINK` | Indicator page | Сторінка показника | reviewed (user, 2026-11-15) |
| 66 | `HEATMAP_INDICATOR_LINK_LABEL` | Indicator page: {name} | Сторінка показника: {name} | reviewed (user, 2026-11-15) |
| 67 | `HOME_AGGREGATES_HEADING` | Aggregates | Агрегати | reviewed (user, 2026-11-15) |
| 68 | `HOME_COUNTRIES_HEADING` | Choose a country | Оберіть країну | reviewed (user, 2026-11-15) |
| 69 | `HOME_FILTER_LABEL.countries` | Filter countries | Фільтр країн | reviewed (user, 2026-11-15) |
| 70 | `HOME_FILTER_LABEL.indicators` | Filter indicators | Фільтр показників | reviewed (user, 2026-11-15) |
| 71 | `HOME_INDICATORS_HEADING` | Choose an indicator | Оберіть показник | reviewed (user, 2026-11-15) |
| 72 | `HOME_LINKS.series` | Time series | Часові ряди | reviewed (user, 2026-11-15) |
| 73 | `HOME_LINKS.domains` | Domains | Домени | reviewed (user, 2026-11-15) |
| 74 | `HOME_LINKS.revisions` | Revisions | Ревізії | reviewed (user, 2026-11-15) |
| 75 | `INDICATOR_SERIES_LINK` | Time series | Часові ряди | reviewed (user, 2026-11-15) |
| 76 | `INFORMATIONAL_NOTICE` | informational, unranked | інформаційний, не ранжується | reviewed (user, 2026-11-15) |
| 77 | `KIND_LABELS.all` | All revisions | Усі ревізії | reviewed (user, 2026-11-15) |
| 78 | `KIND_LABELS.regular` | Regular revisions only | Лише звичайні ревізії | reviewed (user, 2026-11-15) |
| 79 | `KIND_LABELS.reestimation` | Re-estimation revisions only | Лише ревізії-переоцінки | reviewed (user, 2026-11-15) |
| 80 | `NA` | n/a | н/д | reviewed (user, 2026-11-15) |
| 81 | `NAMED_EDITION_MARK` |  (named edition) |  (названий випуск) | reviewed (user, 2026-11-15) |
| 82 | `NAV_LABEL` | Main navigation | Головна навігація | reviewed (user, 2026-11-15) |
| 83 | `NON_EURO_MARK` | non-euro: see the note above | поза єврозоною: див. примітку вище | reviewed (user, 2026-11-15) |
| 84 | `NOT_DOMAIN_PERCENTILE` | It is not the percentile of the domain. | Це не процентиль домену. | reviewed (user, 2026-11-15) |
| 85 | `NOT_PUBLISHED` | not published | не опубліковано | reviewed (user, 2026-11-15) |
| 86 | `NOT_RANKED_INFO_ONLY` | not ranked (information only) | не ранжується (лише інформація) | reviewed (user, 2026-11-15) |
| 87 | `NOT_RANKED_INHERITED` | not ranked (inherited) | не ранжується (успадковано) | reviewed (user, 2026-11-15) |
| 88 | `NOT_SHOWN_NO_BASE` | no usable (positive) value at the base period, so it cannot be rebased | немає придатного (додатного) значення в базовому періоді, тому перебазування неможливе | reviewed (user, 2026-11-15) |
| 89 | `NOT_SHOWN_NO_VALUES` | no values for this transform in the chosen range | немає значень для цього перетворення в обраному діапазоні | reviewed (user, 2026-11-15) |
| 90 | `NOT_SHOWN_TRANSFORM` | this transform is not offered for a series that is not seasonally adjusted | це перетворення не пропонується для ряду без сезонного коригування | reviewed (user, 2026-11-15) |
| 91 | `NO_EDITIONS` | No named edition revised published history in the last 12 months. | Жоден названий випуск не змінював опубліковану історію за останні 12 місяців. | reviewed (user, 2026-11-15) |
| 92 | `NO_INDICATORS` | This domain has no indicators. | У цьому домені немає показників. | reviewed (user, 2026-11-15) |
| 93 | `NO_ORDINARY` | No ordinary revisions in the last 12 months. | За останні 12 місяців звичайних ревізій немає. | reviewed (user, 2026-11-15) |
| 94 | `NO_ORDINARY_CLASS` | No revisions of this class in the last 12 months. | За останні 12 місяців ревізій цього класу немає. | reviewed (user, 2026-11-15) |
| 95 | `NO_POSITION` | no position | немає позиції | reviewed (user, 2026-11-15) |
| 96 | `NO_POSITION_LOW_COVERAGE` | no position (low coverage) | немає позиції (низьке охоплення) | reviewed (user, 2026-11-15) |
| 97 | `NO_RANKING_SPREAD` | No ranking for this indicator, so there is no common reference period or spread. | Для цього показника немає рангу, тому немає спільного опорного періоду чи розкиду. | reviewed (user, 2026-11-15) |
| 98 | `NO_RANK_STALE` | no rank (stale) | немає рангу (застаріле) | reviewed (user, 2026-11-15) |
| 99 | `NO_SERIES` | No series to draw for this selection. | Немає рядів для показу за цим вибором. | reviewed (user, 2026-11-15) |
| 100 | `NO_SERIES_FILE` | No series file for this indicator in this export. | У цьому експорті немає файлу рядів для цього показника. | reviewed (user, 2026-11-15) |
| 101 | `ORIENTATION_NOTE` | Higher percentile means a more favourable position by each indicator's stated direction. | Вищий процентиль означає сприятливішу позицію за заявленим напрямом кожного показника. | reviewed (user, 2026-11-15) |
| 102 | `OTHER_INDICATORS_GROUP` | Other indicators | Інші показники | reviewed (user, 2026-11-15) |
| 103 | `PEER_NOTE_HEAD` | The indicators of this domain are ranked against different sets of countries | Показники цього домену ранжовано щодо різних наборів країн | reviewed (user, 2026-11-15) |
| 104 | `PEER_NOTE_TAIL` | , so the mean percentile mixes peer sets and is only roughly comparable across countries. | , тому середній процентиль змішує набори країн і лише приблизно порівнянний між країнами. | reviewed (user, 2026-11-15) |
| 105 | `PERCENTILE_COLUMN_LABEL` | percentile vs all ranked countries | процентиль серед усіх ранжованих країн | reviewed (user, 2026-11-15) |
| 106 | `POINT_READER_LEGEND` | Read a value | Прочитати значення | reviewed (user, 2026-11-15) |
| 107 | `POSITION_HEADER` | Position | Позиція | reviewed (user, 2026-11-15) |
| 108 | `READER_NONE` | Choose a country | Оберіть країну | reviewed (user, 2026-11-15) |
| 109 | `REBASED_UNIT` | index, base period = 100 | індекс, базовий період = 100 | reviewed (user, 2026-11-15) |
| 110 | `REBASED_Y_LABEL` | Index (base period = 100) | Індекс (базовий період = 100) | reviewed (user, 2026-11-15) |
| 111 | `REBASE_NOTE` | Rebasing is a display scaling only (value / value at the base period x 100). It needs a positive value at the base period. | Перебазування — лише масштабування для показу (значення / значення в базовому періоді × 100). Воно потребує додатного значення в базовому періоді. | reviewed (user, 2026-11-15) |
| 112 | `REBASE_TOGGLE_LABEL` | Rebase to 100 (display only) | Перебазувати до 100 (лише для показу) | reviewed (user, 2026-11-15) |
| 113 | `REESTIMATION_NOTE` | Re-estimation revisions come from sources that re-estimate a whole history at once; they are marked and can be hidden so that they do not crowd out ordinary revisions. | Ревізії-переоцінки надходять від джерел, які переоцінюють усю історію одразу; їх позначено, і їх можна сховати, щоб вони не затуляли звичайні ревізії. | reviewed (user, 2026-11-15) |
| 114 | `REVISED_DATA_HISTORY_MARK` |  (revised-data history) |  (історія ревізованих даних) | reviewed (user, 2026-11-15) |
| 115 | `REVISED_DATA_NOTICE` | Revised data: this view is not a real-time record. Early periods show few revisions because versions exist only from this system's first fetch, and history before that fetch is shown as it stood at that fetch. | Ревізовані дані: цей вигляд не є записом у реальному часі. Ранні періоди показують мало ревізій, бо версії існують лише від першого завантаження цією системою, а історію до нього показано такою, якою вона була на момент того завантаження. | reviewed (user, 2026-11-15) |
| 116 | `SELECTION_LABEL` | Selection | Вибір | reviewed (user, 2026-11-15) |
| 117 | `SERIES_LINK_LABEL` | Time series: {indicatorName}, {countryName} | Часові ряди: {indicatorName}, {countryName} | reviewed (user, 2026-11-15) |
| 118 | `SKIP_LINK_TEXT` | Skip to main content | Перейти до основного вмісту | reviewed (user, 2026-11-15) |
| 119 | `SKIP_TO_TABLE` | Skip to values table | Перейти до таблиці значень | reviewed (user, 2026-11-15) |
| 120 | `SORT_LABELS.percentile` | Percentile (stored), highest first | Процентиль (збережений), від найвищого | reviewed (user, 2026-11-15) |
| 121 | `SORT_LABELS.value_desc` | Latest value, highest first | Останнє значення, від найвищого | reviewed (user, 2026-11-15) |
| 122 | `SORT_LABELS.value_asc` | Latest value, lowest first | Останнє значення, від найнижчого | reviewed (user, 2026-11-15) |
| 123 | `SORT_LABELS.name` | Country name | Назва країни | reviewed (user, 2026-11-15) |
| 124 | `STALE_BANNER` | Data may be out of date: the data cut-off ({date}) is {days} days old, more than {limit} days. | Дані можуть бути застарілими: дата відсікання даних ({date}) була {days} дн. тому, що більше за {limit} дн. | reviewed (user, 2026-11-15) |
| 125 | `STALE_BANNER_UNREADABLE` | Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date. | Свіжість даних невідома: ця збірка не має читабельної дати відсікання даних. Вважайте дані застарілими. | reviewed (user, 2026-11-15) |
| 126 | `STALE_NAME` | stale: no rank | застаріле: немає рангу | reviewed (user, 2026-11-15) |
| 127 | `STATE_CODES.stale` | stale | застаріле | reviewed (user, 2026-11-15) |
| 128 | `STATE_CODES.lagging` | lagging | відстає | reviewed (user, 2026-11-15) |
| 129 | `STATE_CODES.unaligned` | unaligned | не узгоджено | reviewed (user, 2026-11-15) |
| 130 | `STATE_CODES.na` | n/a | н/д | reviewed (user, 2026-11-15) |
| 131 | `STATE_CODES.not_published` | np | не опубл. | reviewed (user, 2026-11-15) |
| 132 | `TIP_KNOWN_AT` | Known at {date} | Відомо станом на {date} | reviewed (user, 2026-11-15) |
| 133 | `TIP_STATUS.EST` | estimate | оцінка | reviewed (user, 2026-11-15) |
| 134 | `TIP_STATUS.PROV` | provisional | попереднє | reviewed (user, 2026-11-15) |
| 135 | `TRANSFORM_LABELS.value` | Level | Рівень | reviewed (user, 2026-11-15) |
| 136 | `TRANSFORM_LABELS.value_default_tf` | Indicator default | Типове для показника | reviewed (user, 2026-11-15) |
| 137 | `TRANSFORM_LABELS.value_yoy` | Year-on-year | Рік до року | reviewed (user, 2026-11-15) |
| 138 | `UNRANKED` | unranked | не ранжується | reviewed (user, 2026-11-15) |
| 139 | `UNRANKED_DOMAIN_CELL` | unranked domain | домен не ранжується | reviewed (user, 2026-11-15) |
| 140 | `UNRANKED_DOMAIN_STATEMENT` | This domain is informational and unranked: no percentile, rank or position is shown. | Цей домен інформаційний і не ранжується: процентиль, ранг чи позицію не показано. | reviewed (user, 2026-11-15) |
| 141 | `VIEW_AS_TABLE` | View as table | Переглянути як таблицю | reviewed (user, 2026-11-15) |
| 142 | `VINTAGE_CHOOSE` | Choose an indicator to load its revision file (one file per indicator). | Оберіть показник, щоб завантажити його файл ревізій (один файл на показник). | reviewed (user, 2026-11-15) |
| 143 | `VINTAGE_EMPTY` | No stored versions of this series for that reference period. | Для цього опорного періоду немає збережених версій цього ряду. | reviewed (user, 2026-11-15) |
| 144 | `VINTAGE_NONE` | No revised key of a headline series in this file. | У цьому файлі немає ревізованого ключа основного ряду. | reviewed (user, 2026-11-15) |
| 145 | `VINTAGE_TEXT` | Vintages are recorded from this system's first fetch and are collected once a month. A revision that happens and is corrected between two fetches is not visible, and the earliest stored version is not necessarily the value the source published first. History before the first fetch is revised data, not real time. | Вінтажі записуються від першого завантаження цією системою й збираються раз на місяць. Ревізія, яка сталася й була виправлена між двома завантаженнями, не видна, а найраніша збережена версія не обов’язково є значенням, яке джерело опублікувало першим. Історія до першого завантаження — це ревізовані дані, а не реальний час. | reviewed (user, 2026-11-15) |
| 146 | `notRankedCell` | not ranked ({alignment}) | не ранжується ({alignment}) | reviewed (user, 2026-11-15) |
| 147 | `HIDDEN_PART.no_data` | {n} no data | {n}: немає даних | reviewed (user, 2026-11-15) |
| 148 | `HIDDEN_PART.stale` | {n} stale | {n}: застарілі | reviewed (user, 2026-11-15) |
| 149 | `HIDDEN_PART.other_period` | {n} other period | {n}: інший період | reviewed (user, 2026-11-15) |
| 150 | `HIDDEN_PART.other` | {n} other | {n}: інше | reviewed (user, 2026-11-15) |
| 151 | `DRAFT_COUNT_COUNTRIES` | one: {n} country; other: {n} countries | one: {n} країна; few: {n} країни; many: {n} країн; other: {n} країни | reviewed (user, 2026-11-15) |
| 152 | `DRAFT_IN_UNIT` | in {unit} | у {unit} | reviewed (user, 2026-11-15) |
| 153 | `FRESHNESS_LINE` | {label}: {date} (build {buildId}). | {label}: {date} (збірка {buildId}). | reviewed (user, 2026-11-15) |
| 154 | `FRESHNESS_UNKNOWN` | unknown | невідомо | reviewed (user, 2026-11-15) |
| 155 | `directionWithTarget` | {label} (target {target}) | {label} (ціль {target}) | reviewed (user, 2026-11-15) |
| 156 | `SITE_TITLE` | Macro Monitor | Macro Monitor | reviewed (user, 2026-11-15) |
