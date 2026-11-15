# Ukrainian string review sheet (G-LANG-STR) - DRAFT, Ukrainian column machine-proposed

Prepared 2026-11-14 from `site/src/lib/copy.js` (every exported `DRAFT_*` constant, 347 leaf entries); the Ukrainian column was filled on 2026-11-15 (V44) with MACHINE-PROPOSED text from `site/src/i18n/uk.json`, where every entry has `status: proposed` and `reviewed_on: null`. Rules (plan gate G-LANG-STR, ADR-025 decision 11): none of this text is reviewed. In a production build a `proposed` Ukrainian entry is not shown: the English text renders inside an element with `lang="en"`; only `MM_SHOW_PROPOSED=1` preview builds show it, with a visible marker. Only the user, or a reviewer the user names, may set an entry to `reviewed` (edit `uk.json`: `status` and `reviewed_on`); an agent never does. Entries with a function value are templates with `{name}` placeholders (the same placeholders as the English template); plural entries list the CLDR categories (en: one, other; uk: one, few, many, other); `copy.js` joins lists with ", " or "; " outside the dictionary.

## Items that need the user before any Ukrainian string is accepted

1. Quarter label forms: proposed en "Q1 2024", uk "1 кв. 2024" (from the plan). Confirm or change.
2. The Ukrainian judgement-word list (words the prose scan must reject in Ukrainian text). Not supplied: the test "Ukrainian judgement words" in `site/tests/i18n-fallback.test.mjs` is skipped until the user adds `site/tests/support/uk-judgement-words.json` (a JSON array of words).
3. Ukrainian entity (country) names: V47 proposes, the user reviews.
4. Whether Ukrainian entries that are not `reviewed` fall back to English with `lang="en"` (plan default) in production. Implemented as the plan default (`site/src/lib/i18n.js`); today every entry is `proposed`, so the production Ukrainian tree is English text under `<html lang="uk">` until entries are reviewed (see `i18n-report.json`).
5. Terminology to confirm: percentile = "процентиль", vintage = "вінтаж", revision = "ревізія", domain = "домен", reference period = "опорний період", SA / NSA = "СК" / "без СК", scorecard = "таблиця показників", n/a = "н/д", estimate mark e = "о", np = "не опубл.".

## Strings

| # | Key | English (current DRAFT) | Ukrainian | Status |
|---|---|---|---|---|
| 1 | `DRAFT_ABOUT_LABELS.indicator` | Indicator | Показник | proposed (machine) |
| 2 | `DRAFT_ABOUT_LABELS.country` | Country | Країна | proposed (machine) |
| 3 | `DRAFT_ABOUT_LABELS.seriesId` | Series id | Ідентифікатор ряду | proposed (machine) |
| 4 | `DRAFT_ABOUT_LABELS.source` | Source | Джерело | proposed (machine) |
| 5 | `DRAFT_ABOUT_LABELS.attribution` | Attribution | Атрибуція | proposed (machine) |
| 6 | `DRAFT_ABOUT_LABELS.frequency` | Frequency | Періодичність | proposed (machine) |
| 7 | `DRAFT_ABOUT_LABELS.unit` | Unit | Одиниця | proposed (machine) |
| 8 | `DRAFT_ABOUT_LABELS.seasonal` | Seasonal adjustment | Сезонне коригування | proposed (machine) |
| 9 | `DRAFT_ABOUT_LABELS.priceBasis` | Price basis | Цінова основа | proposed (machine) |
| 10 | `DRAFT_ABOUT_LABELS.refPeriod` | Reference period | Опорний період | proposed (machine) |
| 11 | `DRAFT_ABOUT_LABELS.knownAt` | Known at | Відомо станом на | proposed (machine) |
| 12 | `DRAFT_ABOUT_LABELS.sourceRelease` | Source release at | Публікація джерела | proposed (machine) |
| 13 | `DRAFT_ABOUT_LABELS.age` | Age (days) | Вік (днів) | proposed (machine) |
| 14 | `DRAFT_ABOUT_LABELS.staleLimit` | Staleness limit (days) | Межа застарілості (днів) | proposed (machine) |
| 15 | `DRAFT_ABOUT_LABELS.transform` | Transform | Перетворення | proposed (machine) |
| 16 | `DRAFT_ABOUT_LABELS.flags` | Flags | Позначки | proposed (machine) |
| 17 | `DRAFT_ABOUT_LABELS.reestimating` | Re-estimation | Переоцінка | proposed (machine) |
| 18 | `DRAFT_ABOUT_SERIES_COLUMNS.country` | Country | Країна | proposed (machine) |
| 19 | `DRAFT_ABOUT_SERIES_COLUMNS.source` | Source | Джерело | proposed (machine) |
| 20 | `DRAFT_ABOUT_SERIES_COLUMNS.attribution` | Attribution | Атрибуція | proposed (machine) |
| 21 | `DRAFT_ABOUT_SERIES_COLUMNS.frequency` | Frequency | Періодичність | proposed (machine) |
| 22 | `DRAFT_ABOUT_SERIES_COLUMNS.unit` | Unit | Одиниця | proposed (machine) |
| 23 | `DRAFT_ABOUT_SERIES_COLUMNS.seasonal` | Seasonal adjustment | Сезонне коригування | proposed (machine) |
| 24 | `DRAFT_ABOUT_SERIES_COLUMNS.priceBasis` | Price basis | Цінова основа | proposed (machine) |
| 25 | `DRAFT_ABOUT_SERIES_COLUMNS.lastPeriod` | Last period | Останній період | proposed (machine) |
| 26 | `DRAFT_ABOUT_SERIES_COLUMNS.knownAt` | Known at (last period) | Відомо станом на (останній період) | proposed (machine) |
| 27 | `DRAFT_ABOUT_SERIES_COLUMNS.reestimating` | Re-estimation | Переоцінка | proposed (machine) |
| 28 | `DRAFT_ABOUT_SERIES_HEADING` | About these series | Про ці ряди | proposed (machine) |
| 29 | `DRAFT_ABOUT_SUMMARY` | About this value | Про це значення | proposed (machine) |
| 30 | `DRAFT_ALL_DOMAINS_LINK` | All domains | Усі домени | proposed (machine) |
| 31 | `DRAFT_BAND_REVISIONS` | Revisions | Ревізії | proposed (machine) |
| 32 | `DRAFT_BAND_TABLE` | Table | Таблиця | proposed (machine) |
| 33 | `DRAFT_BAND_TITLES.overview` | Overview | Огляд | proposed (machine) |
| 34 | `DRAFT_BAND_TITLES.compare` | Compare | Порівняння | proposed (machine) |
| 35 | `DRAFT_BAND_TITLES.indicators` | Indicators | Показники | proposed (machine) |
| 36 | `DRAFT_BAND_TITLES.overTime` | Over time | У часі | proposed (machine) |
| 37 | `DRAFT_BAR_LABEL` | Bar length (revision %) is relative to the largest revision shown. | Довжина стовпця (ревізія, %) відносна до найбільшої показаної ревізії. | proposed (machine) |
| 38 | `DRAFT_BLOCKED_FIELD_LABELS.unit_code` | unit code | код одиниці | proposed (machine) |
| 39 | `DRAFT_BLOCKED_FIELD_LABELS.unit_mult` | unit multiplier | множник одиниці | proposed (machine) |
| 40 | `DRAFT_BLOCKED_FIELD_LABELS.price_basis` | price basis | цінова основа | proposed (machine) |
| 41 | `DRAFT_BLOCKED_FIELD_LABELS.flow_basis` | flow basis | основа потоку | proposed (machine) |
| 42 | `DRAFT_BLOCKED_FIELD_LABELS.base_period` | base period | базовий період | proposed (machine) |
| 43 | `DRAFT_BLOCKED_FIELD_LABELS.frequency` | frequency | періодичність | proposed (machine) |
| 44 | `DRAFT_BLOCKED_MESSAGE` | (function) (fields) => `Not drawn together; differing stored fields: ${fields.join(", ")}` | Не показано разом; збережені поля відрізняються: {fields} | proposed (machine) |
| 45 | `DRAFT_BROWSE_SUMMARY` | Countries, indicators and other pages | Країни, показники та інші сторінки | proposed (machine) |
| 46 | `DRAFT_C1_FIGURE_LABEL` | (function) (name, unit, parts) => `Line chart of ${name}, one line per country, y-axis ${un | Лінійна діаграма: {name}, одна лінія на країну, вісь y: {unit}: {parts}; таблиця під діаграмою містить усі нанесені точки | proposed (machine) |
| 47 | `DRAFT_C1_MARKS` | Dashed grey line: a stored aggregate; square marker: the last point of a stale series; hollow marker: an estimate or provisional value | Штрихова сіра лінія: збережений агрегат; квадратний маркер: остання точка застарілого ряду; порожній маркер: оцінка або попереднє значення | proposed (machine) |
| 48 | `DRAFT_C2_FIGURE_LABEL` | (function) (name, period, unit) => `Bar chart of ${name}, reference period ${period}, in ${ | Стовпчикова діаграма: {name}, опорний період {period}, у {unit}; один стовпець на країну; таблиця нижче містить ті самі значення | proposed (machine) |
| 49 | `DRAFT_C2_MARKS` | Hollow bar: another reference period, with its period in the label; dashed outline: an aggregate, for reference only | Порожній стовпець: інший опорний період, його вказано в підписі; штриховий контур: агрегат, лише для довідки | proposed (machine) |
| 50 | `DRAFT_C2_NO_RANK_REFERENCE` | No ranked reference period for this indicator. | Для цього показника немає ранжованого опорного періоду. | proposed (machine) |
| 51 | `DRAFT_C2_TABLE_CAPTION` | (function) (name, period) => `${name}: stored value by country, reference period ${period}` | {name}: збережене значення за країнами, опорний період {period} | proposed (machine) |
| 52 | `DRAFT_C3_FIGURE_LABEL` | (function) (xName, xUnit, yName, yUnit, period) => `Scatter plot, x-axis ${xName} in ${xUni | Точкова діаграма: вісь x — {xName}, {xUnit}; вісь y — {yName}, {yUnit}; опорний період {period}; одна точка на країну; таблиця нижче містить ті самі значення | proposed (machine) |
| 53 | `DRAFT_C3_MARKS` | Labelled dots are the countries in focus; every country with both values is a dot and is listed in the table. | Підписані точки — країни у фокусі; кожна країна з обома значеннями є точкою й наведена в таблиці. | proposed (machine) |
| 54 | `DRAFT_C3_NO_COMMON` | No reference period has a stored value of both indicators. | Немає опорного періоду зі збереженим значенням обох показників. | proposed (machine) |
| 55 | `DRAFT_C3_TABLE_CAPTION` | (function) (xName, yName, period) => `${xName} and ${yName}: stored values by country, refe | {xName} і {yName}: збережені значення за країнами, опорний період {period} | proposed (machine) |
| 56 | `DRAFT_C4_BLANK` | no stored value | немає збереженого значення | proposed (machine) |
| 57 | `DRAFT_C4_FIGURE_LABEL` | (function) (name, unit, first, last) => `Heatmap of ${name}, in ${unit}, countries by perio | Теплова карта: {name}, у {unit}, країни за періодами, від {first} до {last}; таблиця нижче містить ті самі значення | proposed (machine) |
| 58 | `DRAFT_C4_LEGEND.min` | lowest | найнижче | proposed (machine) |
| 59 | `DRAFT_C4_LEGEND.max` | highest | найвище | proposed (machine) |
| 60 | `DRAFT_C4_MARKS` | Hatched cell: no stored value | Заштрихована клітинка: немає збереженого значення | proposed (machine) |
| 61 | `DRAFT_C4_OUTLINE_MARK` | Dashed outline: a stale row, shown because Show stale rows is on | Штриховий контур: застарілий рядок, показаний, бо ввімкнено «Показувати застарілі рядки» | proposed (machine) |
| 62 | `DRAFT_C4_SCALE` | (function) (min, max) => `${min} to ${max}, the lowest and highest cell shown` | від {min} до {max}, найнижча й найвища показані клітинки | proposed (machine) |
| 63 | `DRAFT_C4_TABLE_CAPTION` | (function) (name, unit) => `${name}: stored value by country and period, in ${unit}` | {name}: збережене значення за країнами та періодами, у {unit} | proposed (machine) |
| 64 | `DRAFT_C6_AGGREGATES_NOTE` | Aggregates and countries outside the map are not drawn; they are listed under the hidden rows and in the table. | Агрегати та країни поза картою не показано; їх наведено серед прихованих рядків і в таблиці. | proposed (machine) |
| 65 | `DRAFT_C6_CARD_TITLE` | Map of values | Карта значень | proposed (machine) |
| 66 | `DRAFT_C6_FIGURE_LABEL` | (function) (name, period, unit) => `Map of Europe: ${name}, reference period ${period}, in  | Карта Європи: {name}, опорний період {period}, у {unit}; одна фігура на країну; таблиця нижче містить ті самі значення | proposed (machine) |
| 67 | `DRAFT_C6_GEO_PENDING` | Loading the map shapes. | Завантаження контурів карти. | proposed (machine) |
| 68 | `DRAFT_C6_GEO_UNREADABLE` | The map shapes could not be read, so the map is not drawn; the table lists the same values | Контури карти не вдалося прочитати, тому карту не показано; таблиця містить ті самі значення | proposed (machine) |
| 69 | `DRAFT_C6_LEGEND_UNIT` | (function) (unit) => `Unit: ${unit}` | Одиниця: {unit} | proposed (machine) |
| 70 | `DRAFT_C6_MARKS` | Hatched: no stored value; plain: a stored value not drawn here; circle: a small country; dashed outline: another reference period | Штриховка: немає збереженого значення; без заливки: збережене значення, яке тут не показано; коло: мала країна; штриховий контур: інший опорний період | proposed (machine) |
| 71 | `DRAFT_C6_NOT_MAPPED.aggregate` | an aggregate, not drawn on the map | агрегат, не показаний на карті | proposed (machine) |
| 72 | `DRAFT_C6_NOT_MAPPED.outside` | outside the map extent | поза межами карти | proposed (machine) |
| 73 | `DRAFT_C6_NOT_MAPPED.nogeometry` | no map shape for this country | для цієї країни немає контуру на карті | proposed (machine) |
| 74 | `DRAFT_C6_NOT_MAPPED_SENTENCE` | (function) (why, stored) => `${why}; ${stored}` | {why}; {stored} | proposed (machine) |
| 75 | `DRAFT_C6_SCALE` | (function) (min, max) => `${min} to ${max}, the lowest and highest country shown; continuou | від {min} до {max}, найнижча й найвища показані країни; неперервна шкала, без класів | proposed (machine) |
| 76 | `DRAFT_C6_SKIP_TO_TABLE` | Skip to the table of map values | Перейти до таблиці значень карти | proposed (machine) |
| 77 | `DRAFT_C6_SOURCE_NOTE` | Map shapes: Natural Earth. | Контури карти: Natural Earth. | proposed (machine) |
| 78 | `DRAFT_C6_STORED` | (function) (value, period) => `${value} (${period})` | {value} ({period}) | proposed (machine) |
| 79 | `DRAFT_C6_TABLE_CAPTION` | (function) (name, period) => `${name}: stored value by country, reference period ${period}, | {name}: збережене значення за країнами, опорний період {period}, як на карті | proposed (machine) |
| 80 | `DRAFT_CAPTION_LABELS.indicator` | Indicator | Показник | proposed (machine) |
| 81 | `DRAFT_CAPTION_LABELS.unit` | Unit | Одиниця | proposed (machine) |
| 82 | `DRAFT_CAPTION_LABELS.frequency` | Frequency | Періодичність | proposed (machine) |
| 83 | `DRAFT_CAPTION_LABELS.seasonal` | Seasonal adjustment | Сезонне коригування | proposed (machine) |
| 84 | `DRAFT_CAPTION_LABELS.period` | Reference period | Опорний період | proposed (machine) |
| 85 | `DRAFT_CAPTION_LABELS.scale` | Colour scale | Колірна шкала | proposed (machine) |
| 86 | `DRAFT_CAPTION_LABELS.source` | Source | Джерело | proposed (machine) |
| 87 | `DRAFT_CAPTION_LABELS.vintage` | Vintage | Вінтаж | proposed (machine) |
| 88 | `DRAFT_CAPTION_LEGEND.EST` | estimate | оцінка | proposed (machine) |
| 89 | `DRAFT_CAPTION_LEGEND.PROV` | provisional | попереднє | proposed (machine) |
| 90 | `DRAFT_CAPTION_SEASONAL.SA` | SA | СК | proposed (machine) |
| 91 | `DRAFT_CAPTION_SEASONAL.NSA` | NSA | без СК | proposed (machine) |
| 92 | `DRAFT_CAPTION_SEASONAL.NA` | not applicable | не застосовується | proposed (machine) |
| 93 | `DRAFT_CAPTION_VINTAGE` | (function) (date) => `latest vintage as of ${date}` | остання версія станом на {date} | proposed (machine) |
| 94 | `DRAFT_CARD_REVISIONS` | Revisions and vintages | Ревізії та вінтажі | proposed (machine) |
| 95 | `DRAFT_CHART_MARKS` | A hollow marker is an estimated or provisional value. A ring around a point is a value that was revised after this system first stored it. A thin vertical line marks the latest observation of a series. A diamond marks an alert and a triangle a watch from the latest analysis run only; the list below the chart gives the level and z for each. | Порожній маркер — оцінене або попереднє значення. Кільце навколо точки — значення, ревізоване після того, як система вперше його зберегла. Тонка вертикальна лінія позначає останнє спостереження ряду. Ромб позначає сповіщення, трикутник — застереження лише за останнім запуском аналізу; список під діаграмою вказує рівень і z для кожного. | proposed (machine) |
| 96 | `DRAFT_CHART_MODES.lines` | Lines | Лінії | proposed (machine) |
| 97 | `DRAFT_CHART_MODES.bars` | Bars | Стовпці | proposed (machine) |
| 98 | `DRAFT_CHART_SHOWS` | Each line is one country's stored values over time; the label at the end of a line gives the country and its latest stored value with the unit. Gaps in a line are periods without a stored value. | Кожна лінія — збережені значення однієї країни в часі; підпис наприкінці лінії містить країну та її останнє збережене значення з одиницею. Розриви в лінії — періоди без збереженого значення. | proposed (machine) |
| 99 | `DRAFT_CHART_TYPE_LEGEND` | Chart type | Тип діаграми | proposed (machine) |
| 100 | `DRAFT_CHOOSE_COUNTRIES_HINT` | Choose up to 5 countries to compare. | Оберіть до 5 країн для порівняння. | proposed (machine) |
| 101 | `DRAFT_CHOOSE_COUNTRY_PLACEHOLDER` | Choose a country to see its key indicators. | Оберіть країну, щоб побачити її ключові показники. | proposed (machine) |
| 102 | `DRAFT_COMPARE_CARD_TITLES.c1` | Time series by country | Часові ряди за країнами | proposed (machine) |
| 103 | `DRAFT_COMPARE_CARD_TITLES.c2` | Ranked values | Ранжовані значення | proposed (machine) |
| 104 | `DRAFT_COMPARE_CARD_TITLES.c3` | Two indicators | Два показники | proposed (machine) |
| 105 | `DRAFT_COMPARE_CARD_TITLES.c4` | Countries by period | Країни за періодами | proposed (machine) |
| 106 | `DRAFT_COMPARE_CARD_TITLES.c5` | Percentile heatmap | Теплова карта процентилів | proposed (machine) |
| 107 | `DRAFT_COMPARE_CARD_TITLES.t2` | Indicator table | Таблиця показників | proposed (machine) |
| 108 | `DRAFT_COMPARE_CHOOSE_INDICATOR` | Choose an indicator to compare countries. | Оберіть показник, щоб порівняти країни. | proposed (machine) |
| 109 | `DRAFT_COMPARE_CHOOSE_PAIR` | Choose two indicators to compare. | Оберіть два показники для порівняння. | proposed (machine) |
| 110 | `DRAFT_COMPARE_CONTROLS_LABEL` | (function) (title) => `Controls: ${title}` | Елементи керування: {title} | proposed (machine) |
| 111 | `DRAFT_COMPARE_CONTROL_LABELS.domain` | Domain | Домен | proposed (machine) |
| 112 | `DRAFT_COMPARE_CONTROL_LABELS.countries` | Countries | Країни | proposed (machine) |
| 113 | `DRAFT_COMPARE_CONTROL_LABELS.x` | X indicator | Показник X | proposed (machine) |
| 114 | `DRAFT_COMPARE_CONTROL_LABELS.y` | Y indicator | Показник Y | proposed (machine) |
| 115 | `DRAFT_COMPARE_CONTROL_LABELS.p` | Reference period | Опорний період | proposed (machine) |
| 116 | `DRAFT_COMPARE_CONTROL_LABELS.choose` | Choose an indicator | Оберіть показник | proposed (machine) |
| 117 | `DRAFT_COMPARE_CONTROL_LABELS.latest` | Default period | Типовий період | proposed (machine) |
| 118 | `DRAFT_COMPARE_CONTROL_LABELS.sort` | Sort by | Сортувати за | proposed (machine) |
| 119 | `DRAFT_COMPARE_DEFAULT_COUNTRIES` | No country is chosen: the default countries are shown. | Жодної країни не обрано: показано країни за замовчуванням. | proposed (machine) |
| 120 | `DRAFT_COMPARE_SECONDARY` | (function) (title) => `Percentile layer: ${title}` | Шар процентилів: {title} | proposed (machine) |
| 121 | `DRAFT_COMPARE_SERIES_PENDING` | Loading the series file of this indicator. | Завантаження файлу рядів цього показника. | proposed (machine) |
| 122 | `DRAFT_COMPARE_SORTS.value` | Value | Значення | proposed (machine) |
| 123 | `DRAFT_COMPARE_SORTS.name` | Country (A to Z) | Країна (А–Я) | proposed (machine) |
| 124 | `DRAFT_COMPARE_SORTS.percentile` | Percentile | Процентиль | proposed (machine) |
| 125 | `DRAFT_COMPAT_SKIPPED` | (function) (fields) => `Not compared, no stored value: ${fields.join(", ")}` | Не порівнюється, немає збереженого значення: {fields} | proposed (machine) |
| 126 | `DRAFT_CONSEQUENCE.lists` | The lists on this page are still shown. | Списки на цій сторінці й далі показано. | proposed (machine) |
| 127 | `DRAFT_CONSEQUENCE.scorecard` | The tables and charts on this page are not shown. | Таблиці та діаграми на цій сторінці не показано. | proposed (machine) |
| 128 | `DRAFT_CONSEQUENCE.explorer` | The chart and tables on this page are not shown. | Діаграму й таблиці на цій сторінці не показано. | proposed (machine) |
| 129 | `DRAFT_CONSEQUENCE.revisions` | The revision lists on this page are not shown. | Списки ревізій на цій сторінці не показано. | proposed (machine) |
| 130 | `DRAFT_CONTEXT_LINES` | Context lines | Контекстні лінії | proposed (machine) |
| 131 | `DRAFT_COUNTRY_CARD_TITLES.k1` | Latest values | Останні значення | proposed (machine) |
| 132 | `DRAFT_COUNTRY_CARD_TITLES.l1` | Time series | Часові ряди | proposed (machine) |
| 133 | `DRAFT_COUNTRY_CARD_TITLES.p1` | Position among countries | Позиція серед країн | proposed (machine) |
| 134 | `DRAFT_COUNTRY_CARD_TITLES.t1` | Indicator table | Таблиця показників | proposed (machine) |
| 135 | `DRAFT_COUNTRY_CARD_TITLES.l2` | Series | Ряди | proposed (machine) |
| 136 | `DRAFT_COUNTRY_CHIP_HELP` | Select up to 5 countries. | Оберіть до 5 країн. | proposed (machine) |
| 137 | `DRAFT_COUNTRY_COLUMNS.indicator` | Indicator | Показник | proposed (machine) |
| 138 | `DRAFT_COUNTRY_COLUMNS.value` | Latest value | Останнє значення | proposed (machine) |
| 139 | `DRAFT_COUNTRY_COLUMNS.period` | Reference period | Опорний період | proposed (machine) |
| 140 | `DRAFT_COUNTRY_COLUMNS.percentile` | percentile vs all ranked countries | процентиль серед усіх ранжованих країн | proposed (machine) |
| 141 | `DRAFT_COUNTRY_COLUMNS.source` | Source | Джерело | proposed (machine) |
| 142 | `DRAFT_COUNTRY_COLUMNS.actions` | Actions | Дії | proposed (machine) |
| 143 | `DRAFT_COUNTRY_COLUMNS.reason` | Why there is no value | Чому немає значення | proposed (machine) |
| 144 | `DRAFT_COUNTRY_FILTER_ALL` | All indicators | Усі показники | proposed (machine) |
| 145 | `DRAFT_COUNTRY_FILTER_LEGEND` | Show | Показати | proposed (machine) |
| 146 | `DRAFT_COUNTRY_FILTER_VALUE` | Only indicators with a value | Лише показники зі значенням | proposed (machine) |
| 147 | `DRAFT_COUNTRY_GROUPS_LABEL` | Groups | Групи | proposed (machine) |
| 148 | `DRAFT_COUNTRY_KIND_LABEL` | Kind | Тип | proposed (machine) |
| 149 | `DRAFT_COUNTRY_LIMIT` | (function) (n) => `You can select up to ${n} countries. Clear one to select another.` | Можна обрати до {n} країн. Приберіть одну, щоб обрати іншу. | proposed (machine) |
| 150 | `DRAFT_COUNTRY_NO_GROUPS` | none | немає | proposed (machine) |
| 151 | `DRAFT_COUNTRY_SELECTED` | (function) (n) => `${n} selected` | Обрано: {n} | proposed (machine) |
| 152 | `DRAFT_COUNTRY_SWITCHER_GO` | Go | Перейти | proposed (machine) |
| 153 | `DRAFT_COUNTRY_SWITCHER_LABEL` | Switch country | Змінити країну | proposed (machine) |
| 154 | `DRAFT_COUNTRY_TABLE_CAPTION` | (function) (domainName, countryName) => `${domainName}: indicators of ${countryName}` | {domainName}: показники країни {countryName} | proposed (machine) |
| 155 | `DRAFT_CRUMB_COUNTRIES` | Countries | Країни | proposed (machine) |
| 156 | `DRAFT_CRUMB_HOME` | Home | Головна | proposed (machine) |
| 157 | `DRAFT_CRUMB_INDICATORS` | Indicators | Показники | proposed (machine) |
| 158 | `DRAFT_CRUMB_LABEL` | Breadcrumb | Навігаційний ланцюжок | proposed (machine) |
| 159 | `DRAFT_DOMAINS_BAND` | All domains | Усі домени | proposed (machine) |
| 160 | `DRAFT_DOWNLOAD` | Download the data file of this indicator | Завантажити файл даних цього показника | proposed (machine) |
| 161 | `DRAFT_EMPTY_CARD` | No values for this selection. | Немає значень для цього вибору. | proposed (machine) |
| 162 | `DRAFT_ERROR_INVALID` | (function) (region) => `The data of ${region} did not pass the format check, so it is not u | Дані розділу «{region}» не пройшли перевірку формату, тому їх не використано. | proposed (machine) |
| 163 | `DRAFT_ERROR_TITLE` | (function) (region) => `Could not load ${region}.` | Не вдалося завантажити: {region}. | proposed (machine) |
| 164 | `DRAFT_ERROR_VERSION` | (function) (region) => `This page cannot read ${region}: its data version is not supported  | Ця сторінка не може прочитати розділ «{region}»: версія даних не підтримується цим інтерфейсом. | proposed (machine) |
| 165 | `DRAFT_EXPLORER_FIGURE_LABEL` | (function) (title, yLabel, parts) => `Line chart of ${title}, y-axis ${yLabel}. ${parts.joi | Лінійна діаграма: {title}, вісь y: {yLabel}. {parts}. Таблиця під діаграмою містить усі нанесені точки. | proposed (machine) |
| 166 | `DRAFT_FACET_COLLAPSE` | Collapse | Згорнути | proposed (machine) |
| 167 | `DRAFT_FACET_EXPAND` | Expand | Розгорнути | proposed (machine) |
| 168 | `DRAFT_FACET_STATEMENT` | More than 5 countries are selected, so each country has its own chart. | Обрано понад 5 країн, тому кожна країна має власну діаграму. | proposed (machine) |
| 169 | `DRAFT_FACT_LABELS.value` | Latest value | Останнє значення | proposed (machine) |
| 170 | `DRAFT_FACT_LABELS.refPeriod` | Reference period | Опорний період | proposed (machine) |
| 171 | `DRAFT_FACT_LABELS.refOffset` | Reference offset (days) | Зсув опорного періоду (днів) | proposed (machine) |
| 172 | `DRAFT_FACT_LABELS.release` | Source release | Публікація джерела | proposed (machine) |
| 173 | `DRAFT_FACT_LABELS.age` | Age (days) | Вік (днів) | proposed (machine) |
| 174 | `DRAFT_FACT_LABELS.limit` | Staleness limit (days) | Межа застарілості (днів) | proposed (machine) |
| 175 | `DRAFT_FACT_LABELS.flags` | Flags | Позначки | proposed (machine) |
| 176 | `DRAFT_FIGURE_COVERAGE` | (function) (nAvailable, nDefined) => `${nAvailable} of ${nDefined} indicators available` | Доступно показників: {nAvailable} з {nDefined} | proposed (machine) |
| 177 | `DRAFT_FIGURE_POSITION` | (function) (position, nRanked) => `position ${position} of ${nRanked}` | позиція {position} з {nRanked} | proposed (machine) |
| 178 | `DRAFT_FILTER_ALL.countries` | All countries | Усі країни | proposed (machine) |
| 179 | `DRAFT_FILTER_ALL.domains` | All domains | Усі домени | proposed (machine) |
| 180 | `DRAFT_FILTER_ALL.frequencies` | All frequencies | Усі періодичності | proposed (machine) |
| 181 | `DRAFT_FILTER_CHIP_SUMMARY` | (function) (label, value) => `${label}: ${value}` | {label}: {value} | proposed (machine) |
| 182 | `DRAFT_FILTER_LABELS.filters` | Filters | Фільтри | proposed (machine) |
| 183 | `DRAFT_FILTER_LABELS.group` | Group | Група | proposed (machine) |
| 184 | `DRAFT_FILTER_LABELS.country` | Country | Країна | proposed (machine) |
| 185 | `DRAFT_FILTER_LABELS.domain` | Domain | Домен | proposed (machine) |
| 186 | `DRAFT_FILTER_LABELS.indicator` | Indicator | Показник | proposed (machine) |
| 187 | `DRAFT_FILTER_LABELS.period` | Period | Період | proposed (machine) |
| 188 | `DRAFT_FILTER_LABELS.frequency` | Frequency | Періодичність | proposed (machine) |
| 189 | `DRAFT_FILTER_LABELS.from` | From | Від | proposed (machine) |
| 190 | `DRAFT_FILTER_LABELS.to` | To | До | proposed (machine) |
| 191 | `DRAFT_FILTER_LABELS.all` | All | Усі | proposed (machine) |
| 192 | `DRAFT_FILTER_LABELS.reset` | Reset filters | Скинути фільтри | proposed (machine) |
| 193 | `DRAFT_FREE_Y_LABEL` | Free y-axis (used when more than 5 countries are selected) | Вільна вісь y (застосовується, коли обрано понад 5 країн) | proposed (machine) |
| 194 | `DRAFT_FREQUENCY_NAMES.D` | Daily | Щоденна | proposed (machine) |
| 195 | `DRAFT_FREQUENCY_NAMES.M` | Monthly | Щомісячна | proposed (machine) |
| 196 | `DRAFT_FREQUENCY_NAMES.Q` | Quarterly | Щоквартальна | proposed (machine) |
| 197 | `DRAFT_FREQUENCY_NAMES.A` | Annual | Щорічна | proposed (machine) |
| 198 | `DRAFT_GROUP_BROWSE` | Browse | Огляд | proposed (machine) |
| 199 | `DRAFT_GROUP_REFERENCE_ROWS` | Reference rows | Довідкові рядки | proposed (machine) |
| 200 | `DRAFT_HEATMAP_CAPTION` | (function) (domainName, label) => `${domainName}: ${label}, and the percentile of each indi | {domainName}: {label} і процентиль кожного показника за країнами | proposed (machine) |
| 201 | `DRAFT_HEATMAP_CAPTION_INFO` | (function) (domainName) => `${domainName}: latest value of each indicator, by country (${IN | {domainName}: останнє значення кожного показника за країнами ({INFORMATIONAL_NOTICE}) | proposed (machine) |
| 202 | `DRAFT_HIDDEN_LIST_ITEM` | (function) (label, reasonLabel, period, sentence) => `${label}: ${reasonLabel}; latest valu | {label}: {reasonLabel}; останнє значення {period}; {sentence} | proposed (machine) |
| 203 | `DRAFT_HIDDEN_REASON_LABELS.no_data` | No data | Немає даних | proposed (machine) |
| 204 | `DRAFT_HIDDEN_REASON_LABELS.stale` | Stale | Застаріле | proposed (machine) |
| 205 | `DRAFT_HIDDEN_REASON_LABELS.other_period` | Other period | Інший період | proposed (machine) |
| 206 | `DRAFT_HIDDEN_REASON_LABELS.other` | Other | Інше | proposed (machine) |
| 207 | `DRAFT_HIDDEN_ROWS` | (function) (n) => (n > 1 ? `${n} rows hidden by the period filter` : n === 1 ? "1 row hidde | one: Приховано 1 рядок фільтром періоду; few: Приховано {n} рядки фільтром періоду; many: Приховано {n} рядків фільтром періоду; other: Приховано {n} рядка фільтром періоду | proposed (machine) |
| 208 | `DRAFT_HIDDEN_ROW_ITEM` | (function) (name, period) => `${name}: latest value ${period}` | {name}: останнє значення {period} | proposed (machine) |
| 209 | `DRAFT_HIDDEN_SUMMARY` | (function) (counts) => {   const parts = Object.keys(HIDDEN_PARTS).filter((k) => counts?.[k | one: Приховано {n} рядок: {parts}; few: Приховано {n} рядки: {parts}; many: Приховано {n} рядків: {parts}; other: Приховано {n} рядка: {parts} | proposed (machine) |
| 210 | `DRAFT_HISTORY_CONSEQUENCE` | No history chart is shown for this indicator. | Діаграму історії для цього показника не показано. | proposed (machine) |
| 211 | `DRAFT_HISTORY_FIGURE_LABEL` | (function) (indicatorName, countryName, unit) => `history of ${indicatorName} for ${country | історія показника «{indicatorName}» для {countryName}, у {unit}; таблиця нижче містить останні значення | proposed (machine) |
| 212 | `DRAFT_HISTORY_HIDE` | Hide history | Сховати історію | proposed (machine) |
| 213 | `DRAFT_HISTORY_REGION` | the history of this indicator | історія цього показника | proposed (machine) |
| 214 | `DRAFT_HISTORY_SHOW` | Show history | Показати історію | proposed (machine) |
| 215 | `DRAFT_HISTORY_TABLE_TITLE` | (function) (indicatorName, countryName) => `${indicatorName}: ${countryName}` | {indicatorName}: {countryName} | proposed (machine) |
| 216 | `DRAFT_HOME_DOMAINS_TITLE` | Domains | Домени (alias of HOME_LINKS.domains) | proposed (machine) |
| 217 | `DRAFT_HOME_FILTER_COUNT` | (function) (n) => `${n} shown` | показано: {n} | proposed (machine) |
| 218 | `DRAFT_HOME_FILTER_NONE` | No match. | Нічого не знайдено. | proposed (machine) |
| 219 | `DRAFT_HOME_H1` | Macro dashboard | Макроекономічна панель | proposed (machine) |
| 220 | `DRAFT_INCLUDE_OTHER_PERIODS` | Include rows from other reference periods | Включити рядки з інших опорних періодів | proposed (machine) |
| 221 | `DRAFT_INDICATOR_COLUMNS.country` | Country | Країна | proposed (machine) |
| 222 | `DRAFT_INDICATOR_COLUMNS.value` | Latest value | Останнє значення | proposed (machine) |
| 223 | `DRAFT_INDICATOR_COLUMNS.period` | Reference period | Опорний період | proposed (machine) |
| 224 | `DRAFT_INDICATOR_COLUMNS.offset` | Offset (days) | Зсув (днів) | proposed (machine) |
| 225 | `DRAFT_INDICATOR_COLUMNS.percentile` | percentile vs all ranked countries | процентиль серед усіх ранжованих країн | proposed (machine) |
| 226 | `DRAFT_INDICATOR_COLUMNS_MORE.flags` | Flags | Позначки | proposed (machine) |
| 227 | `DRAFT_INDICATOR_COLUMNS_MORE.source` | Source | Джерело | proposed (machine) |
| 228 | `DRAFT_INDICATOR_COLUMNS_MORE.actions` | Actions | Дії | proposed (machine) |
| 229 | `DRAFT_INDICATOR_COLUMNS_MORE.reason` | Why there is no value | Чому немає значення | proposed (machine) |
| 230 | `DRAFT_INDICATOR_FACT_LABELS.id` | Identifier | Ідентифікатор | proposed (machine) |
| 231 | `DRAFT_INDICATOR_FACT_LABELS.domains` | Domains | Домени | proposed (machine) |
| 232 | `DRAFT_INDICATOR_FACT_LABELS.unit` | Unit | Одиниця | proposed (machine) |
| 233 | `DRAFT_INDICATOR_FACT_LABELS.frequency` | Frequency | Періодичність | proposed (machine) |
| 234 | `DRAFT_INDICATOR_FACT_LABELS.direction` | Direction | Напрям | proposed (machine) |
| 235 | `DRAFT_INDICATOR_FACT_LABELS.notes` | Notes | Примітки | proposed (machine) |
| 236 | `DRAFT_INDICATOR_FACT_LABELS.transform` | Transform | Перетворення | proposed (machine) |
| 237 | `DRAFT_INDICATOR_SORT_LABEL` | Sort by | Сортувати за | proposed (machine) |
| 238 | `DRAFT_INDICATOR_SORT_LABELS.name` | Country | Країна | proposed (machine) |
| 239 | `DRAFT_INDICATOR_SORT_LABELS.value` | Value | Значення | proposed (machine) |
| 240 | `DRAFT_INDICATOR_SORT_LABELS.percentile` | Percentile | Процентиль | proposed (machine) |
| 241 | `DRAFT_INDICATOR_SORT_LABELS.period` | Reference period | Опорний період | proposed (machine) |
| 242 | `DRAFT_INDICATOR_SWITCHER_GO` | Go | Перейти | proposed (machine) |
| 243 | `DRAFT_INDICATOR_TABLE_CAPTION` | (function) (indicatorName) => `${indicatorName}: latest values by country` | {indicatorName}: останні значення за країнами | proposed (machine) |
| 244 | `DRAFT_KPI_ERROR_CONSEQUENCE` | The key indicators are not shown. | Ключові показники не показано. | proposed (machine) |
| 245 | `DRAFT_L1_SUMMARY` | (function) (domainName) => `${domainName}: time series` | {domainName}: часові ряди | proposed (machine) |
| 246 | `DRAFT_LEGEND_BINS` | Percentile bins | Інтервали процентилів | proposed (machine) |
| 247 | `DRAFT_LEGEND_STATES` | Cell marks | Позначки клітинок | proposed (machine) |
| 248 | `DRAFT_LEGEND_TITLE` | Legend | Легенда | proposed (machine) |
| 249 | `DRAFT_LOADING` | (function) (what) => `Loading ${what}...` | Завантаження: {what}... | proposed (machine) |
| 250 | `DRAFT_LOAD_HISTORY` | Load history | Завантажити історію | proposed (machine) |
| 251 | `DRAFT_MARKED_SEASONAL` | Mixes SA and NSA series | Поєднує ряди з СК і без СК | proposed (machine) |
| 252 | `DRAFT_MODE_LABELS.country` | Country | Країна | proposed (machine) |
| 253 | `DRAFT_MODE_LABELS.compare` | Compare | Порівняння | proposed (machine) |
| 254 | `DRAFT_MODE_SWITCH_LABEL` | Mode | Режим | proposed (machine) |
| 255 | `DRAFT_NA_DEFINED_SENTENCE` | A series is defined for this country, but this export holds no value for it. | Ряд для цієї країни визначено, але в цьому експорті немає його значення. | proposed (machine) |
| 256 | `DRAFT_NA_NO_PERCENTILE_SENTENCE` | This export holds a value but no percentile for it. | У цьому експорті є значення, але немає його процентиля. | proposed (machine) |
| 257 | `DRAFT_NA_NO_RANKED_SENTENCE` | No indicator of this domain has a ranked value for this country. | Жоден показник цього домену не має ранжованого значення для цієї країни. | proposed (machine) |
| 258 | `DRAFT_NEXT_GROUP` | Choose another group or another indicator. | Оберіть іншу групу або інший показник. | proposed (machine) |
| 259 | `DRAFT_NEXT_SERIES` | Choose at least one country, or another indicator or range. | Оберіть щонайменше одну країну або інший показник чи діапазон. | proposed (machine) |
| 260 | `DRAFT_NOSCRIPT` | This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page. | Для показу таблиць і діаграм цій панелі потрібен JavaScript. Увімкніть JavaScript і перезавантажте сторінку. | proposed (machine) |
| 261 | `DRAFT_NOT_PUBLISHED_SENTENCE` | Not published on this site. | Не опубліковано на цьому сайті. | proposed (machine) |
| 262 | `DRAFT_NOT_STATED` | not stated | не зазначено | proposed (machine) |
| 263 | `DRAFT_NO_ALIGNED` | No aligned values for this selection | Немає узгоджених значень для цього вибору | proposed (machine) |
| 264 | `DRAFT_NO_VALUE_FOR` | (function) (names) => `no value for ${names.join(", ")}` | немає значення для: {names} | proposed (machine) |
| 265 | `DRAFT_OFFSET_FLAG` | (function) (days) => `offset ${days} days` | зсув {days} дн. | proposed (machine) |
| 266 | `DRAFT_OPEN_AS_SERIES` | Open as time series | Відкрити як часовий ряд | proposed (machine) |
| 267 | `DRAFT_P1A_AGGREGATES_NOTE` | Dashed lines mark the stored value of an aggregate, for reference only. | Штрихові лінії позначають збережене значення агрегату, лише для довідки. | proposed (machine) |
| 268 | `DRAFT_P1A_FIGURE_LABEL` | (function) (indicatorName, period, unit) => `Strip plot of ${indicatorName}, reference peri | Точкова смуга: {indicatorName}, опорний період {period}, у {unit}; кожна країна — одна точка; таблиця нижче містить ті самі значення | proposed (machine) |
| 269 | `DRAFT_P1A_MARKS` | Ring: the country in focus; hollow dot: an estimate or a value of another reference period | Кільце: країна у фокусі; порожня точка: оцінка або значення іншого опорного періоду | proposed (machine) |
| 270 | `DRAFT_P1A_NO_REFERENCE` | The scorecard states no reference period for this indicator. | Таблиця показників не вказує опорний період для цього показника. | proposed (machine) |
| 271 | `DRAFT_P1A_REFERENCE` | (function) (period) => `Reference period: ${period}` | Опорний період: {period} | proposed (machine) |
| 272 | `DRAFT_P1A_TABLE_CAPTION` | (function) (indicatorName, period) => `${indicatorName}: latest stored value by country, re | {indicatorName}: останнє збережене значення за країнами, опорний період {period} | proposed (machine) |
| 273 | `DRAFT_PEER_DIRECTION` | (function) (directionText) => `Direction of this indicator: ${directionText}.` | Напрям цього показника: {directionText}. | proposed (machine) |
| 274 | `DRAFT_PEER_FIGURE_LABEL` | (function) (indicatorName, n, column) => `Dot plot of the ${column} for ${indicatorName}, $ | Точкова діаграма: {column} для {indicatorName}, {count}. Таблиця нижче містить ті самі значення. | proposed (machine) |
| 275 | `DRAFT_PEER_FOCUS_HINT` | Select a country name to highlight it in the chart and the table; select it again to clear. | Оберіть назву країни, щоб виділити її на діаграмі й у таблиці; оберіть ще раз, щоб зняти виділення. | proposed (machine) |
| 276 | `DRAFT_PEER_GUIDES` | The grey lines mark 0.25, 0.5 and 0.75 on the scale. | Сірі лінії позначають 0,25, 0,5 і 0,75 на шкалі. | proposed (machine) |
| 277 | `DRAFT_PEER_MARKS` | Filled dot: value observed for this country. Hollow dot: estimated or inherited value. The ring marks the country in focus. | Заповнена точка: значення, спостережене для цієї країни. Порожня точка: оцінене або успадковане значення. Кільце позначає країну у фокусі. | proposed (machine) |
| 278 | `DRAFT_PEER_NOT_DRAWN` | A country without a stored percentile (lagging, unaligned, stale or not ranked) is listed in the table only. | Країна без збереженого процентиля (відстає, не узгоджена, застаріла або не ранжується) наведена лише в таблиці. | proposed (machine) |
| 279 | `DRAFT_PEER_TABLE_CAPTION` | (function) (indicatorName) => `${indicatorName}: latest value and stored percentile, by cou | {indicatorName}: останнє значення та збережений процентиль за країнами | proposed (machine) |
| 280 | `DRAFT_PERIOD_INVALID` | The From year must not be after the To year. The period was not changed. | Рік «Від» не може бути пізнішим за рік «До». Період не змінено. | proposed (machine) |
| 281 | `DRAFT_PERIOD_PRESETS.all` | All | Усі | proposed (machine) |
| 282 | `DRAFT_PERIOD_PRESETS.last10` | Last 10 years | Останні 10 років | proposed (machine) |
| 283 | `DRAFT_PERIOD_PRESETS.last5` | Last 5 years | Останні 5 років | proposed (machine) |
| 284 | `DRAFT_PERIOD_REGION` | the period range | діапазон періоду | proposed (machine) |
| 285 | `DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE` | The period filter is not available; all years are shown. | Фільтр періоду недоступний; показано всі роки. | proposed (machine) |
| 286 | `DRAFT_PERIOD_VALUE` | (function) (from, to) => `${from} to ${to}` | від {from} до {to} | proposed (machine) |
| 287 | `DRAFT_PICKER_LABELS.country` | Country | Країна | proposed (machine) |
| 288 | `DRAFT_PICKER_LABELS.group` | Group | Група | proposed (machine) |
| 289 | `DRAFT_PICKER_LABELS.countries` | Countries | Країни | proposed (machine) |
| 290 | `DRAFT_PICKER_LABELS.aggregates` | Aggregates | Агрегати | proposed (machine) |
| 291 | `DRAFT_PICKER_LABELS.placeholder` | Choose a country | Оберіть країну | proposed (machine) |
| 292 | `DRAFT_PRINT_FILTERS` | (function) (parts) => `Filters: ${parts.length ? parts.join("; ") : "none"}` | Фільтри: {parts} (empty: немає) | proposed (machine) |
| 293 | `DRAFT_PROFILE_DOT_LABEL` | (function) (name, percentileText) => `${name}: ${percentileText}` | {name}: {percentileText} | proposed (machine) |
| 294 | `DRAFT_PROFILE_FIGURE_LABEL` | (function) (countryName, domainName) => `percentile of each indicator for ${countryName}, d | процентиль кожного показника для {countryName}, домен {domainName}; таблиця нижче містить ті самі значення | proposed (machine) |
| 295 | `DRAFT_RANK_COLUMNS.bar` | Bar | Стовпець | proposed (machine) |
| 296 | `DRAFT_RANK_COLUMNS.dot` | Percentile position | Позиція процентиля | proposed (machine) |
| 297 | `DRAFT_RANK_SORT_LABELS.name` | Country (A to Z) | Країна (А–Я) | proposed (machine) |
| 298 | `DRAFT_RANK_SORT_LABELS.value` | Value | Значення | proposed (machine) |
| 299 | `DRAFT_RANK_SORT_LABELS.percentile` | Percentile | Процентиль | proposed (machine) |
| 300 | `DRAFT_REBASE_MARKS` | The grey lines mark the index value 100 and the base period. | Сірі лінії позначають значення індексу 100 і базовий період. | proposed (machine) |
| 301 | `DRAFT_REBASE_STATEMENT` | (function) (period) => `Index, ${period} = 100, rebased for display; stored values unchange | Індекс, {period} = 100, перебазовано лише для показу; збережені значення не змінено. | proposed (machine) |
| 302 | `DRAFT_REESTIMATED_MARK` | re-estimated | переоцінено | proposed (machine) |
| 303 | `DRAFT_REGIONS.manifest` | the data manifest | маніфест даних | proposed (machine) |
| 304 | `DRAFT_REGIONS.meta` | the descriptions of countries, indicators and series | описи країн, показників і рядів | proposed (machine) |
| 305 | `DRAFT_REGIONS.scorecard` | the scorecard of this domain | таблиця показників цього домену | proposed (machine) |
| 306 | `DRAFT_REGIONS.domains` | the list of domains | список доменів | proposed (machine) |
| 307 | `DRAFT_REGIONS.alerts` | the current alerts | поточні сповіщення | proposed (machine) |
| 308 | `DRAFT_REGIONS.recent` | the list of recent revisions | список останніх ревізій | proposed (machine) |
| 309 | `DRAFT_REGIONS.series` | the series file of this indicator | файл рядів цього показника | proposed (machine) |
| 310 | `DRAFT_REGIONS.revisionFile` | the revision file of this indicator | файл ревізій цього показника | proposed (machine) |
| 311 | `DRAFT_REGIONS.loadingData` | the dashboard data | дані панелі | proposed (machine) |
| 312 | `DRAFT_REGIONS.loadingSeries` | the series of this indicator | ряди цього показника | proposed (machine) |
| 313 | `DRAFT_REGIONS.loadingRevisions` | the revision history of this indicator | історія ревізій цього показника | proposed (machine) |
| 314 | `DRAFT_REVISIONS_LINK_LABEL` | (function) (indicatorName) => `Revisions of ${indicatorName}` | Ревізії: {indicatorName} | proposed (machine) |
| 315 | `DRAFT_SCROLL_HINT` | Scroll sideways to see more indicators. | Прокрутіть вбік, щоб побачити більше показників. | proposed (machine) |
| 316 | `DRAFT_SELECT_GROUP` | Select group | Обрати групу | proposed (machine) |
| 317 | `DRAFT_SERIES_LABEL_PART` | (function) (name, from, to, latestText) => `${name}, ${from} to ${to}, latest stored value  | {name}, від {from} до {to}, останнє збережене значення {latestText} | proposed (machine) |
| 318 | `DRAFT_SERIES_UNREADABLE` | The series file of this indicator could not be read. | Файл рядів цього показника не вдалося прочитати. | proposed (machine) |
| 319 | `DRAFT_SHOW_MORE` | Show more | Показати більше | proposed (machine) |
| 320 | `DRAFT_SHOW_PERCENTILE` | Show percentile | Показувати процентиль | proposed (machine) |
| 321 | `DRAFT_SHOW_STALE` | Show stale rows | Показувати застарілі рядки | proposed (machine) |
| 322 | `DRAFT_SPARKLINE_TOO_FEW` | Too few values in the selected period. | Замало значень у вибраному періоді. | proposed (machine) |
| 323 | `DRAFT_STALE_CODE` | stale | застаріле | proposed (machine) |
| 324 | `DRAFT_STALE_PERIOD` | (function) (period) => `stale, ${period}` | застаріле, {period} | proposed (machine) |
| 325 | `DRAFT_STALE_TIP` | (function) (period) => `stale, latest stored period ${period}` | застаріле, останній збережений період {period} | proposed (machine) |
| 326 | `DRAFT_STATE_COLUMN` | State | Стан | proposed (machine) |
| 327 | `DRAFT_STEP_CHOOSE_PERIOD` | Choose one reference period to see its step chart. | Оберіть один опорний період, щоб побачити його ступінчасту діаграму. | proposed (machine) |
| 328 | `DRAFT_STEP_FIGURE_LABEL` | (function) (title, country, period, yLabel, parts) => `Step chart of ${title} for ${country | Ступінчаста діаграма: {title} для {country}, опорний період {period}, вісь y: {yLabel}. {parts}. Таблиця версій нижче містить ті самі точки. | proposed (machine) |
| 329 | `DRAFT_STEP_FIGURE_PART` | (function) (known, valueText) => `${known}: ${valueText}` | {known}: {valueText} | proposed (machine) |
| 330 | `DRAFT_STEP_NOTE` | Each step is a stored version, drawn from the day it was known. The hollow point is the earliest stored version. A cross marks a removal. | Кожен крок — збережена версія, намальована від дня, коли вона стала відомою. Порожня точка — найраніша збережена версія. Хрестик позначає вилучення. | proposed (machine) |
| 331 | `DRAFT_STEP_REMOVED` | removed | вилучено | proposed (machine) |
| 332 | `DRAFT_STEP_SKIP` | Skip to version table | Перейти до таблиці версій | proposed (machine) |
| 333 | `DRAFT_SUBREGION_CONSEQUENCE` | The rest of this page is still shown. Choose another indicator to try again. | Решту сторінки й далі показано. Оберіть інший показник, щоб спробувати ще раз. | proposed (machine) |
| 334 | `DRAFT_TABLE_CAPTION` | (function) (title, n) => `${title}: plotted values, latest ${n} periods of each series` | {title}: нанесені значення, останні періоди кожного ряду (кількість: {n}) | proposed (machine) |
| 335 | `DRAFT_TABLE_CAPTION_ALL` | (function) (title) => `${title}: plotted values, every plotted period of each series` | {title}: нанесені значення, кожен нанесений період кожного ряду | proposed (machine) |
| 336 | `DRAFT_TABLE_HEADERS.value` | Value | Значення | proposed (machine) |
| 337 | `DRAFT_TABLE_HEADERS.status` | Status | Статус | proposed (machine) |
| 338 | `DRAFT_TITLE_UNIT` | (function) (unit) => ` (${unit})` |  ({unit}) | proposed (machine) |
| 339 | `DRAFT_TRANSFORMED_HEADER` | (function) (transformLabel) => `Transformed value (${transformLabel})` | Перетворене значення ({transformLabel}) | proposed (machine) |
| 340 | `DRAFT_UNIT_MISSING_SENTENCE` | This export holds no unit for this value. | У цьому експорті немає одиниці для цього значення. | proposed (machine) |
| 341 | `DRAFT_VALUE_AXIS_TITLE` | (function) (indicatorName, unit) => `${indicatorName} (${unit \|\| DRAFT_UNIT_MISSING_SENTENC | {indicatorName} ({unit}) | proposed (machine) |
| 342 | `DRAFT_VALUE_ESTIMATE_MARK` | e | о | proposed (machine) |
| 343 | `DRAFT_VALUE_FIGURE_LABEL` | (function) (indicatorName, unit, n) => `Bar chart of ${indicatorName}, ${unit ? `in ${unit} | Стовпчикова діаграма: {indicatorName}, {unitPhrase}, {count}; таблиця нижче містить ті самі значення | proposed (machine) |
| 344 | `DRAFT_VALUE_HEADER_UNIT` | (function) (unit) => `Value (${unit})` | Значення ({unit}) | proposed (machine) |
| 345 | `DRAFT_VALUE_NEUTRAL_LEGEND` | No percentile | Немає процентиля | proposed (machine) |
| 346 | `DRAFT_WITHOUT_VALUE_GROUP` | Indicators without a value in this export | Показники без значення в цьому експорті | proposed (machine) |
| 347 | `DRAFT_Y_MODE` | (function) (free) => (free   ? "Each chart has its own y-axis scale: the shape of a series  | free: Кожна діаграма має власну шкалу осі y: форму ряду легко побачити, але рівні між діаграмами порівнювати не можна.; shared: Усі діаграми мають спільну шкалу осі y, тому рівні країн можна порівнювати. | proposed (machine) |

## Other strings (confirmed or earlier wording; Ukrainian machine-proposed)

The English text of these entries is the wording confirmed in earlier gates or a fixed statement; the Ukrainian column is proposed only. Plural and helper keys added by V44 are included (plural keys are shown by their base key).

| # | Key | English | Ukrainian | Status |
|---|---|---|---|---|
| 1 | `AGGREGATE_NOT_RANKED` | aggregate (not ranked) | агрегат (не ранжується) | proposed (machine) |
| 2 | `AHEAD_NAME` | ranked at its latest value, ahead of the common period | ранжовано за останнім значенням, яке випереджає спільний період | proposed (machine) |
| 3 | `AHEAD_TAG` | ahead | випереджає | proposed (machine) |
| 4 | `ALERTS_HEADING` | Current alerts (latest run only) | Поточні сповіщення (лише останній запуск) | proposed (machine) |
| 5 | `ALERT_LEVEL_PREFIX` | alert level:  | рівень сповіщення:  | proposed (machine) |
| 6 | `ALERT_NOT_DRAWN` |  (not drawn: no plotted value at that period) |  (не показано: немає значення на цей період) | proposed (machine) |
| 7 | `ALL_LABEL` | All countries | Усі країни | proposed (machine) |
| 8 | `ALL_PERIODS` | All reference periods | Усі опорні періоди | proposed (machine) |
| 9 | `BIN_LABELS.0` | lowest fifth of the panel | найнижча п’ята частина вибірки | proposed (machine) |
| 10 | `BIN_LABELS.1` | second fifth of the panel | друга п’ята частина вибірки | proposed (machine) |
| 11 | `BIN_LABELS.2` | middle fifth of the panel | середня п’ята частина вибірки | proposed (machine) |
| 12 | `BIN_LABELS.3` | fourth fifth of the panel | четверта п’ята частина вибірки | proposed (machine) |
| 13 | `BIN_LABELS.4` | highest fifth of the panel | найвища п’ята частина вибірки | proposed (machine) |
| 14 | `CAVEAT` | Percentiles are relative position in the covered panel, not a judgement of structural quality. | Процентилі показують відносну позицію в охопленій вибірці, а не оцінку структурної якості. | proposed (machine) |
| 15 | `CHOOSE_INDICATOR_OPTION` | choose an indicator | оберіть показник | proposed (machine) |
| 16 | `CLASS_LABEL.regular` | regular | звичайні | proposed (machine) |
| 17 | `CLASS_LABEL.reestimation` | re-estimation | переоцінка | proposed (machine) |
| 18 | `COMPARE_COUNTRIES` | Compare countries | Порівняння країн | proposed (machine) |
| 19 | `COMPARE_COUNTRIES_LABEL` | Compare countries: {indicatorName} | Порівняння країн: {indicatorName} | proposed (machine) |
| 20 | `COUNTRY_HEADER` | Country | Країна | proposed (machine) |
| 21 | `COVERAGE_HEADER` | Indicators available (n/N) | Доступні показники (n/N) | proposed (machine) |
| 22 | `DESCRIPTIVE_CELL` | descriptive, not ranked | описовий, не ранжується | proposed (machine) |
| 23 | `DETAILS_SUMMARY` | Values and reference periods | Значення та опорні періоди | proposed (machine) |
| 24 | `DIRECTION_LABELS.higher` | higher is better | більше — краще | proposed (machine) |
| 25 | `DIRECTION_LABELS.lower` | lower is better | менше — краще | proposed (machine) |
| 26 | `DIRECTION_LABELS.target` | closer to target is better | ближче до цільового значення — краще | proposed (machine) |
| 27 | `DIRECTION_LABELS.descriptive` | descriptive, not ranked | описовий, не ранжується | proposed (machine) |
| 28 | `DOMAIN_FIGURE_LABEL` | mean percentile of the domain's indicators | середній процентиль показників домену | proposed (machine) |
| 29 | `DRAFT_HOME_CONTROLS_LABEL` | Controls: Home panels | Елементи керування: панелі головної сторінки | proposed (machine) |
| 30 | `DRAFT_HOME_COUNTRY_LABEL` | Open a country | Відкрити країну | proposed (machine) |
| 31 | `DRAFT_HOME_KPI_FOR` | Latest stored value for {name} | Останнє збережене значення: {name} | proposed (machine) |
| 32 | `DRAFT_HOME_KPI_NOT_LOADED` | The scorecard of this indicator could not be read. | Таблицю показників цього показника не вдалося прочитати. | proposed (machine) |
| 33 | `DRAFT_HOME_KPI_NO_VALUE` | No stored value for this entity in this export. | У цьому експорті немає збереженого значення для цієї одиниці. | proposed (machine) |
| 34 | `DRAFT_HOME_KPI_TITLE` | Key indicators | Ключові показники | proposed (machine) |
| 35 | `DRAFT_HOME_MISSING_ITEM` | {constant}: {id} is not in the stored lists, so it is left out | {constant}: ідентифікатора {id} немає в збережених списках, тому його пропущено | proposed (machine) |
| 36 | `DRAFT_HOME_MISSING_SUMMARY` | Some Home settings name an id this export does not carry | Деякі налаштування головної сторінки називають ідентифікатор, якого немає в цьому експорті | proposed (machine) |
| 37 | `DRAFT_HOME_MODE_LABEL` | Mode | Режим | proposed (machine) |
| 38 | `DRAFT_HOME_PANELS_LABEL` | Comparison panels | Панелі порівняння | proposed (machine) |
| 39 | `DRAFT_HOME_PANEL_TITLES.c2` | Ranked values | Ранжовані значення | proposed (machine) |
| 40 | `DRAFT_HOME_PANEL_TITLES.c1` | Time series by country | Часові ряди за країнами | proposed (machine) |
| 41 | `DRAFT_HOME_PANEL_TITLES.c6` | Map of values | Карта значень | proposed (machine) |
| 42 | `DRAFT_HOME_PANEL_TITLES.c4` | Countries by period | Країни за періодами | proposed (machine) |
| 43 | `DRAFT_HOME_SCORECARD_PENDING` | Loading the stored values. | Завантаження збережених значень. | proposed (machine) |
| 44 | `EARLIEST_LABEL` | earliest stored version | найраніша збережена версія | proposed (machine) |
| 45 | `EDITIONS_INTRO` | A named edition (for example an IMF WEO release) can rebase history for thousands of keys at once, so it is shown as one line and never ranked among the ordinary revisions. | Названий випуск (наприклад, публікація МВФ WEO) може перебазувати історію для тисяч ключів одночасно, тому його показано одним рядком і ніколи не ранжовано серед звичайних ревізій. | proposed (machine) |
| 46 | `EMPTY_GROUP` | No countries of this group have a value for this indicator in this domain. | Жодна країна цієї групи не має значення цього показника в цьому домені. | proposed (machine) |
| 47 | `ESTIMATE_MARK` | e | о | proposed (machine) |
| 48 | `FILTER_NOTE` | The group filter only filters and sorts the list. Every percentile shown is the percentile vs all ranked countries; it is not recomputed within the group. | Фільтр групи лише відбирає та сортує список. Кожен показаний процентиль — це процентиль серед усіх ранжованих країн; усередині групи його не перераховують. | proposed (machine) |
| 49 | `FLAG_AHEAD` | ahead | випереджає | proposed (machine) |
| 50 | `FLAG_ESTIMATE` | estimate | оцінка | proposed (machine) |
| 51 | `FLAG_INHERITED` | inherited from the euro area | успадковано від єврозони | proposed (machine) |
| 52 | `FLAG_LAGGING` | lagging | відстає | proposed (machine) |
| 53 | `FLAG_LOW_COVERAGE` | low coverage | низьке охоплення | proposed (machine) |
| 54 | `FLAG_UNALIGNED` | unaligned | не узгоджено | proposed (machine) |
| 55 | `FLAG_UNALIGNED_FISCAL` | unaligned (fiscal-year basis) | не узгоджено (за фіскальним роком) | proposed (machine) |
| 56 | `FRESHNESS_LABEL` | Data cut-off | Дата відсікання даних | proposed (machine) |
| 57 | `GROUP_LABELS.g7` | G7 | G7 | proposed (machine) |
| 58 | `GROUP_LABELS.euro_area` | Euro area | Єврозона | proposed (machine) |
| 59 | `GROUP_LABELS.non_euro_eu` | EU members outside the euro area | Країни ЄС поза єврозоною | proposed (machine) |
| 60 | `GROUP_LABELS.advanced` | Advanced economies | Розвинені економіки | proposed (machine) |
| 61 | `GROUP_LABELS.emerging` | Emerging economies | Економіки, що розвиваються | proposed (machine) |
| 62 | `G_STR1_NO_SERIES` | This export lists no series for this country and indicator. | Цей експорт не містить рядів для цієї країни та показника. | proposed (machine) |
| 63 | `HASH_FALLBACK_NOTE` | Part of this link was not recognised and was ignored. | Частину цього посилання не розпізнано й проігноровано. | proposed (machine) |
| 64 | `HASH_NO_ROWS_NOTE` | Not selected: this export has no values of this indicator for {names}. | Не обрано: цей експорт не має значень цього показника для: {names}. | proposed (machine) |
| 65 | `HEATMAP_INDICATOR_LINK` | Indicator page | Сторінка показника | proposed (machine) |
| 66 | `HEATMAP_INDICATOR_LINK_LABEL` | Indicator page: {name} | Сторінка показника: {name} | proposed (machine) |
| 67 | `HOME_AGGREGATES_HEADING` | Aggregates | Агрегати | proposed (machine) |
| 68 | `HOME_COUNTRIES_HEADING` | Choose a country | Оберіть країну | proposed (machine) |
| 69 | `HOME_FILTER_LABEL.countries` | Filter countries | Фільтр країн | proposed (machine) |
| 70 | `HOME_FILTER_LABEL.indicators` | Filter indicators | Фільтр показників | proposed (machine) |
| 71 | `HOME_INDICATORS_HEADING` | Choose an indicator | Оберіть показник | proposed (machine) |
| 72 | `HOME_LINKS.series` | Time series | Часові ряди | proposed (machine) |
| 73 | `HOME_LINKS.domains` | Domains | Домени | proposed (machine) |
| 74 | `HOME_LINKS.revisions` | Revisions | Ревізії | proposed (machine) |
| 75 | `INDICATOR_SERIES_LINK` | Time series | Часові ряди | proposed (machine) |
| 76 | `INFORMATIONAL_NOTICE` | informational, unranked | інформаційний, не ранжується | proposed (machine) |
| 77 | `KIND_LABELS.all` | All revisions | Усі ревізії | proposed (machine) |
| 78 | `KIND_LABELS.regular` | Regular revisions only | Лише звичайні ревізії | proposed (machine) |
| 79 | `KIND_LABELS.reestimation` | Re-estimation revisions only | Лише ревізії-переоцінки | proposed (machine) |
| 80 | `NA` | n/a | н/д | proposed (machine) |
| 81 | `NAMED_EDITION_MARK` |  (named edition) |  (названий випуск) | proposed (machine) |
| 82 | `NAV_LABEL` | Main navigation | Головна навігація | proposed (machine) |
| 83 | `NON_EURO_MARK` | non-euro: see the note above | поза єврозоною: див. примітку вище | proposed (machine) |
| 84 | `NOT_DOMAIN_PERCENTILE` | It is not the percentile of the domain. | Це не процентиль домену. | proposed (machine) |
| 85 | `NOT_PUBLISHED` | not published | не опубліковано | proposed (machine) |
| 86 | `NOT_RANKED_INFO_ONLY` | not ranked (information only) | не ранжується (лише інформація) | proposed (machine) |
| 87 | `NOT_RANKED_INHERITED` | not ranked (inherited) | не ранжується (успадковано) | proposed (machine) |
| 88 | `NOT_SHOWN_NO_BASE` | no usable (positive) value at the base period, so it cannot be rebased | немає придатного (додатного) значення в базовому періоді, тому перебазування неможливе | proposed (machine) |
| 89 | `NOT_SHOWN_NO_VALUES` | no values for this transform in the chosen range | немає значень для цього перетворення в обраному діапазоні | proposed (machine) |
| 90 | `NOT_SHOWN_TRANSFORM` | this transform is not offered for a series that is not seasonally adjusted | це перетворення не пропонується для ряду без сезонного коригування | proposed (machine) |
| 91 | `NO_EDITIONS` | No named edition revised published history in the last 12 months. | Жоден названий випуск не змінював опубліковану історію за останні 12 місяців. | proposed (machine) |
| 92 | `NO_INDICATORS` | This domain has no indicators. | У цьому домені немає показників. | proposed (machine) |
| 93 | `NO_ORDINARY` | No ordinary revisions in the last 12 months. | За останні 12 місяців звичайних ревізій немає. | proposed (machine) |
| 94 | `NO_ORDINARY_CLASS` | No revisions of this class in the last 12 months. | За останні 12 місяців ревізій цього класу немає. | proposed (machine) |
| 95 | `NO_POSITION` | no position | немає позиції | proposed (machine) |
| 96 | `NO_POSITION_LOW_COVERAGE` | no position (low coverage) | немає позиції (низьке охоплення) | proposed (machine) |
| 97 | `NO_RANKING_SPREAD` | No ranking for this indicator, so there is no common reference period or spread. | Для цього показника немає рангу, тому немає спільного опорного періоду чи розкиду. | proposed (machine) |
| 98 | `NO_RANK_STALE` | no rank (stale) | немає рангу (застаріле) | proposed (machine) |
| 99 | `NO_SERIES` | No series to draw for this selection. | Немає рядів для показу за цим вибором. | proposed (machine) |
| 100 | `NO_SERIES_FILE` | No series file for this indicator in this export. | У цьому експорті немає файлу рядів для цього показника. | proposed (machine) |
| 101 | `ORIENTATION_NOTE` | Higher percentile means a more favourable position by each indicator's stated direction. | Вищий процентиль означає сприятливішу позицію за заявленим напрямом кожного показника. | proposed (machine) |
| 102 | `OTHER_INDICATORS_GROUP` | Other indicators | Інші показники | proposed (machine) |
| 103 | `PEER_NOTE_HEAD` | The indicators of this domain are ranked against different sets of countries | Показники цього домену ранжовано щодо різних наборів країн | proposed (machine) |
| 104 | `PEER_NOTE_TAIL` | , so the mean percentile mixes peer sets and is only roughly comparable across countries. | , тому середній процентиль змішує набори країн і лише приблизно порівнянний між країнами. | proposed (machine) |
| 105 | `PERCENTILE_COLUMN_LABEL` | percentile vs all ranked countries | процентиль серед усіх ранжованих країн | proposed (machine) |
| 106 | `POINT_READER_LEGEND` | Read a value | Прочитати значення | proposed (machine) |
| 107 | `POSITION_HEADER` | Position | Позиція | proposed (machine) |
| 108 | `READER_NONE` | Choose a country | Оберіть країну | proposed (machine) |
| 109 | `REBASED_UNIT` | index, base period = 100 | індекс, базовий період = 100 | proposed (machine) |
| 110 | `REBASED_Y_LABEL` | Index (base period = 100) | Індекс (базовий період = 100) | proposed (machine) |
| 111 | `REBASE_NOTE` | Rebasing is a display scaling only (value / value at the base period x 100). It needs a positive value at the base period. | Перебазування — лише масштабування для показу (значення / значення в базовому періоді × 100). Воно потребує додатного значення в базовому періоді. | proposed (machine) |
| 112 | `REBASE_TOGGLE_LABEL` | Rebase to 100 (display only) | Перебазувати до 100 (лише для показу) | proposed (machine) |
| 113 | `REESTIMATION_NOTE` | Re-estimation revisions come from sources that re-estimate a whole history at once; they are marked and can be hidden so that they do not crowd out ordinary revisions. | Ревізії-переоцінки надходять від джерел, які переоцінюють усю історію одразу; їх позначено, і їх можна сховати, щоб вони не затуляли звичайні ревізії. | proposed (machine) |
| 114 | `REVISED_DATA_HISTORY_MARK` |  (revised-data history) |  (історія ревізованих даних) | proposed (machine) |
| 115 | `REVISED_DATA_NOTICE` | Revised data: this view is not a real-time record. Early periods show few revisions because versions exist only from this system's first fetch, and history before that fetch is shown as it stood at that fetch. | Ревізовані дані: цей вигляд не є записом у реальному часі. Ранні періоди показують мало ревізій, бо версії існують лише від першого завантаження цією системою, а історію до нього показано такою, якою вона була на момент того завантаження. | proposed (machine) |
| 116 | `SELECTION_LABEL` | Selection | Вибір | proposed (machine) |
| 117 | `SERIES_LINK_LABEL` | Time series: {indicatorName}, {countryName} | Часові ряди: {indicatorName}, {countryName} | proposed (machine) |
| 118 | `SKIP_LINK_TEXT` | Skip to main content | Перейти до основного вмісту | proposed (machine) |
| 119 | `SKIP_TO_TABLE` | Skip to values table | Перейти до таблиці значень | proposed (machine) |
| 120 | `SORT_LABELS.percentile` | Percentile (stored), highest first | Процентиль (збережений), від найвищого | proposed (machine) |
| 121 | `SORT_LABELS.value_desc` | Latest value, highest first | Останнє значення, від найвищого | proposed (machine) |
| 122 | `SORT_LABELS.value_asc` | Latest value, lowest first | Останнє значення, від найнижчого | proposed (machine) |
| 123 | `SORT_LABELS.name` | Country name | Назва країни | proposed (machine) |
| 124 | `STALE_BANNER` | Data may be out of date: the data cut-off ({date}) is {days} days old, more than {limit} days. | Дані можуть бути застарілими: дата відсікання даних ({date}) була {days} дн. тому, що більше за {limit} дн. | proposed (machine) |
| 125 | `STALE_BANNER_UNREADABLE` | Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date. | Свіжість даних невідома: ця збірка не має читабельної дати відсікання даних. Вважайте дані застарілими. | proposed (machine) |
| 126 | `STALE_NAME` | stale: no rank | застаріле: немає рангу | proposed (machine) |
| 127 | `STATE_CODES.stale` | stale | застаріле | proposed (machine) |
| 128 | `STATE_CODES.lagging` | lagging | відстає | proposed (machine) |
| 129 | `STATE_CODES.unaligned` | unaligned | не узгоджено | proposed (machine) |
| 130 | `STATE_CODES.na` | n/a | н/д | proposed (machine) |
| 131 | `STATE_CODES.not_published` | np | не опубл. | proposed (machine) |
| 132 | `TIP_KNOWN_AT` | Known at {date} | Відомо станом на {date} | proposed (machine) |
| 133 | `TIP_STATUS.EST` | estimate | оцінка | proposed (machine) |
| 134 | `TIP_STATUS.PROV` | provisional | попереднє | proposed (machine) |
| 135 | `TRANSFORM_LABELS.value` | Level | Рівень | proposed (machine) |
| 136 | `TRANSFORM_LABELS.value_default_tf` | Indicator default | Типове для показника | proposed (machine) |
| 137 | `TRANSFORM_LABELS.value_yoy` | Year-on-year | Рік до року | proposed (machine) |
| 138 | `UNRANKED` | unranked | не ранжується | proposed (machine) |
| 139 | `UNRANKED_DOMAIN_CELL` | unranked domain | домен не ранжується | proposed (machine) |
| 140 | `UNRANKED_DOMAIN_STATEMENT` | This domain is informational and unranked: no percentile, rank or position is shown. | Цей домен інформаційний і не ранжується: процентиль, ранг чи позицію не показано. | proposed (machine) |
| 141 | `VIEW_AS_TABLE` | View as table | Переглянути як таблицю | proposed (machine) |
| 142 | `VINTAGE_CHOOSE` | Choose an indicator to load its revision file (one file per indicator). | Оберіть показник, щоб завантажити його файл ревізій (один файл на показник). | proposed (machine) |
| 143 | `VINTAGE_EMPTY` | No stored versions of this series for that reference period. | Для цього опорного періоду немає збережених версій цього ряду. | proposed (machine) |
| 144 | `VINTAGE_NONE` | No revised key of a headline series in this file. | У цьому файлі немає ревізованого ключа основного ряду. | proposed (machine) |
| 145 | `VINTAGE_TEXT` | Vintages are recorded from this system's first fetch and are collected once a month. A revision that happens and is corrected between two fetches is not visible, and the earliest stored version is not necessarily the value the source published first. History before the first fetch is revised data, not real time. | Вінтажі записуються від першого завантаження цією системою й збираються раз на місяць. Ревізія, яка сталася й була виправлена між двома завантаженнями, не видна, а найраніша збережена версія не обов’язково є значенням, яке джерело опублікувало першим. Історія до першого завантаження — це ревізовані дані, а не реальний час. | proposed (machine) |
| 146 | `notRankedCell` | not ranked ({alignment}) | не ранжується ({alignment}) | proposed (machine) |
| 147 | `HIDDEN_PART.no_data` | {n} no data | {n}: немає даних | proposed (machine) |
| 148 | `HIDDEN_PART.stale` | {n} stale | {n}: застарілі | proposed (machine) |
| 149 | `HIDDEN_PART.other_period` | {n} other period | {n}: інший період | proposed (machine) |
| 150 | `HIDDEN_PART.other` | {n} other | {n}: інше | proposed (machine) |
| 151 | `DRAFT_COUNT_COUNTRIES` | one: {n} country; other: {n} countries | one: {n} країна; few: {n} країни; many: {n} країн; other: {n} країни | proposed (machine) |
| 152 | `DRAFT_IN_UNIT` | in {unit} | у {unit} | proposed (machine) |
| 153 | `FRESHNESS_LINE` | {label}: {date} (build {buildId}). | {label}: {date} (збірка {buildId}). | proposed (machine) |
| 154 | `FRESHNESS_UNKNOWN` | unknown | невідомо | proposed (machine) |
| 155 | `directionWithTarget` | {label} (target {target}) | {label} (ціль {target}) | proposed (machine) |
| 156 | `SITE_TITLE` | Macro Monitor | Macro Monitor | proposed (machine) |
