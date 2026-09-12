import type { Locale } from "./locales";

/*
 * Every string the interface shows, in both published languages.
 *
 * `Dictionary` is inferred from the English entry, so the Turkish one is checked
 * against it by the compiler: a key added on one side and forgotten on the other
 * is a build error rather than an English word surfacing mid-sentence.
 *
 * Interpolated text is a function rather than a template with placeholders. A
 * placeholder string has to be split and rejoined at the call site, which is
 * where word order gets lost — and word order is exactly what differs between
 * these two languages.
 *
 * Not here: the warnings and failure messages the data layer produces. Those are
 * fixed sentences by design, and turning them into codes the interface resolves
 * is a change to that layer rather than to this one.
 */

const en = {
  metadata: {
    title: "Uniswap Strategy Advisor",
    description:
      "An educational AI-assisted advisor for Uniswap v3 and v4 liquidity strategies. Guidance only — not financial advice.",
    poolTitle: "Pool range analysis · Uniswap Strategy Advisor",
    poolDescription:
      "Historical-volatility price band for one Ethereum mainnet Uniswap v3 pool, aligned onto the pool's tick grid.",
  },

  preferences: {
    languageLabel: "Language",
    themeLabel: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
  },

  disclaimer: {
    ariaLabel: "Important disclaimer",
    title: "Educational tool — not financial advice.",
    body: "This application explains Uniswap mechanics and helps you reason about parameter choices. It does not predict prices, does not guarantee returns, and cannot verify that any smart contract is safe. Liquidity provision carries real risk, including impermanent loss and total loss of funds. Always verify contract addresses and do your own research.",
  },

  home: {
    badge: "Early foundation",
    title: "Uniswap Strategy Advisor",
    introBeforeV3: "An AI-powered advisor for Uniswap ",
    introBetween: " and ",
    introAfterV4:
      ". Describe what you are trying to do in ordinary language, and get an explanation of the features and parameters involved — without needing to know the low-level mechanics first.",
    workingTodayHeading: "Working today",
    workingTodayBody:
      "The deterministic half of the pipeline runs end to end: a pool's verified configuration and current market state, its last 30 completed days of closing prices, historical volatility, a log-symmetric price band, and the Uniswap tick range that band aligns onto. No AI is involved in any of those figures, and none of them is estimated to fill a gap.",
    analysePool: "Analyse a pool →",
    methodHeading: "How it will work",
    methodSteps: [
      {
        step: "Verified data",
        detail:
          "Pool statistics are fetched from Uniswap subgraphs and public registries, never assumed.",
      },
      {
        step: "Deterministic maths",
        detail:
          "Volatility, ranges and liquidity metrics are computed in plain TypeScript, so the numbers are reproducible.",
      },
      {
        step: "AI interpretation",
        detail:
          "The model explains what those figures mean for your goal. It is not allowed to invent them.",
      },
    ],
    coverageHeading: "Planned coverage",
    coverage: [
      {
        version: "Uniswap v3",
        features: [
          {
            name: "Concentrated liquidity",
            summary:
              "Choosing a price range that matches how much of the time you want your capital earning fees.",
          },
          {
            name: "Fee tier selection",
            summary:
              "Comparing the available fee tiers for a pair against how that pair actually trades.",
          },
          {
            name: "Range orders",
            summary:
              "Using a one-sided position to convert between two tokens as price moves through a band.",
          },
        ],
      },
      {
        version: "Uniswap v4",
        features: [
          {
            name: "Hook discovery",
            summary:
              "Finding published hooks relevant to a goal, with their limitations stated plainly.",
          },
          {
            name: "Dynamic fee hooks",
            summary:
              "Understanding when a fee that responds to market conditions is worth the added complexity.",
          },
          {
            name: "TWAMM-style strategies",
            summary:
              "Spreading a large order over time instead of executing it against a single point of liquidity.",
          },
        ],
      },
    ],
    footer:
      "The planned coverage above is not built yet: there is no AI interpretation, no persistence and no wallet connection. What works today is the verified-data and deterministic-maths half, which the advisor is built on so that nothing further up can invent a figure. The advisor produces recommendations only — it will never sign or send a transaction on your behalf.",
  },

  pool: {
    back: "← Uniswap Strategy Advisor",
    addressLabel: "Ethereum mainnet Uniswap v3 pool address",
    analyse: "Analyse",
    addressHelp:
      "The address of the pool contract itself, not a token. Read-only: this application never connects a wallet and never sends a transaction.",
    invalidAddress:
      "That is not an Ethereum address. An address is 0x followed by exactly 40 hexadecimal characters.",
    loading: "Reading pool data…",
  },

  report: {
    steps: {
      pool: "reading the pool's configuration",
      snapshot: "reading the pool's current market state",
      history: "reading the pool's daily price history",
      volatility: "measuring historical volatility",
      band: "building the price band",
      range: "aligning the band onto the pool's tick grid",
    },
    noRangeHeading: "No range for this pool",
    stoppedWhile: (step: string) => `This stopped while ${step}.`,
    poolSummary: (feeTier: string, tickSpacing: string) =>
      `Uniswap v3 on Ethereum mainnet · ${feeTier} fee tier · tick spacing ${tickSpacing}`,
    caveatsHeading: (count: number) =>
      count === 1 ? "One caveat applies to these figures." : `${count} caveats apply to these figures.`,
    caveatsAriaLabel: "Caveats",

    rangeHeading: "Suggested tick range",
    lowerTick: "Lower tick",
    upperTick: "Upper tick",
    priceAt: (price: string, quote: string, base: string) =>
      `Price ${price} ${quote} per ${base}`,
    width: "Width",
    widthValue: (ticks: string) => `${ticks} ticks`,
    widthNote: (spacings: string, tickSpacing: string) =>
      `${spacings} spacings of ${tickSpacing}`,
    inRange: "Currently in range",
    yes: "Yes",
    no: "No",
    inRangeNote: "The pool's current tick sits inside these bounds.",
    outOfRangeNote:
      "A position here would hold a single token and earn nothing until price returns.",
    lowerEdge: "Lower edge",
    upperEdge: "Upper edge",
    truncated: "Truncated",
    asAsked: "As asked",
    lowerTruncatedNote: "Stopped at the lowest tick this pool accepts.",
    upperTruncatedNote: "Stopped at the highest tick this pool accepts.",

    currentStateHeading: "Current state",
    tokenPrice: (symbol: string) => `${symbol} price`,
    quotePerBase: (quote: string, base: string) => `${quote} per ${base}`,
    currentTick: "Current tick",
    sourceReportedTick: (tick: string) => `Source reported ${tick}.`,
    noSourceTick:
      "The source reported no tick of its own, so this conversion is unverified.",
    tvl: "Total value locked",
    sourceBlock: "Source block",
    noBlockTime: "No block time reported.",
    fetchedAt: "Fetched at",
    fetchedAtNote: "When the response arrived, not what it describes.",

    volatilityHeading: "Historical volatility",
    annualised: "Annualised",
    annualisedNote:
      "Sample standard deviation of daily log returns, scaled by sqrt(365).",
    daily: "Daily",
    window: "Window",
    windowNote: (returns: string) => `${returns} usable daily returns.`,
    coverage: "Coverage",
    coverageNote: "How much of the window had consecutive daily prices behind it.",

    bandHeading: "Price band this range came from",
    horizon: "Horizon",
    horizonValue: (days: string) => `${days} days`,
    horizonNote: "How far ahead the band is scaled.",
    multiplier: "Multiplier",
    multiplierNote: "Horizon standard deviations, not a confidence level.",
    lowerBound: "Lower bound",
    upperBound: "Upper bound",
    downside: "Downside",
    downsideNote: "Distance from the current price to the lower bound.",
    upside: "Upside",
    upsideNote: "Distance from the current price to the upper bound.",

    epilogue:
      "The band is symmetric in log space, which makes it deliberately asymmetric in percentage terms: a move down to half price and a move up to double price are the same distance in logs, and only one of them is “50%”. It assumes no expected return, describes how far price has moved historically, and is not a forecast. The multiplier is not a confidence level. Nothing here sizes a position or says how much of either token to deposit.",
  },

  rateLimited: {
    title: "Too many requests",
    body: (limit: number) =>
      `This page reads live Uniswap data on every visit, so it is limited to ${limit} analyses per minute.`,
    retry: (seconds: number) =>
      `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
    back: "Back to the advisor",
  },
};

export type Dictionary = typeof en;

const tr: Dictionary = {
  metadata: {
    title: "Uniswap Strateji Danışmanı",
    description:
      "Uniswap v3 ve v4 likidite stratejileri için eğitim amaçlı, yapay zekâ destekli bir danışman. Yalnızca bilgilendirme — yatırım tavsiyesi değildir.",
    poolTitle: "Havuz aralığı analizi · Uniswap Strateji Danışmanı",
    poolDescription:
      "Bir Ethereum mainnet Uniswap v3 havuzu için tarihsel volatiliteye dayalı fiyat bandı, havuzun tick ızgarasına hizalanmış hâliyle.",
  },

  preferences: {
    languageLabel: "Dil",
    themeLabel: "Tema",
    themeSystem: "Sistem",
    themeLight: "Açık",
    themeDark: "Koyu",
  },

  disclaimer: {
    ariaLabel: "Önemli uyarı",
    title: "Eğitim aracı — yatırım tavsiyesi değildir.",
    body: "Bu uygulama Uniswap mekaniklerini açıklar ve parametre seçimleri üzerine düşünmene yardım eder. Fiyat tahmini yapmaz, getiri garantisi vermez ve hiçbir akıllı sözleşmenin güvenli olduğunu doğrulayamaz. Likidite sağlamak, geçici kayıp ve paranın tamamının kaybı dahil gerçek riskler taşır. Sözleşme adreslerini daima kendin doğrula ve kendi araştırmanı yap.",
  },

  home: {
    badge: "Erken aşama",
    title: "Uniswap Strateji Danışmanı",
    introBeforeV3: "Uniswap ",
    introBetween: " ve ",
    introAfterV4:
      " için yapay zekâ destekli bir danışman. Ne yapmak istediğini gündelik dille anlat, ilgili özelliklerin ve parametrelerin açıklamasını al — düşük seviyeli mekanikleri önceden bilmen gerekmeden.",
    workingTodayHeading: "Bugün çalışan kısım",
    workingTodayBody:
      "Boru hattının deterministik yarısı uçtan uca çalışıyor: havuzun doğrulanmış yapılandırması ve güncel piyasa durumu, tamamlanmış son 30 günün kapanış fiyatları, tarihsel volatilite, log-simetrik bir fiyat bandı ve o bandın hizalandığı Uniswap tick aralığı. Bu sayıların hiçbirinde yapay zekâ yok ve hiçbiri bir boşluğu doldurmak için tahmin edilmiyor.",
    analysePool: "Bir havuzu analiz et →",
    methodHeading: "Nasıl çalışacak",
    methodSteps: [
      {
        step: "Doğrulanmış veri",
        detail:
          "Havuz istatistikleri Uniswap subgraph'larından ve açık kayıtlardan çekilir, asla varsayılmaz.",
      },
      {
        step: "Deterministik hesap",
        detail:
          "Volatilite, aralık ve likidite metrikleri düz TypeScript ile hesaplanır; böylece sayılar yeniden üretilebilir.",
      },
      {
        step: "Yapay zekâ yorumu",
        detail:
          "Model bu sayıların senin hedefin için ne anlama geldiğini açıklar. Onları uydurmasına izin verilmez.",
      },
    ],
    coverageHeading: "Planlanan kapsam",
    coverage: [
      {
        version: "Uniswap v3",
        features: [
          {
            name: "Yoğunlaştırılmış likidite",
            summary:
              "Sermayenin ne kadar süre komisyon kazanmasını istediğine uygun bir fiyat aralığı seçmek.",
          },
          {
            name: "Komisyon kademesi seçimi",
            summary:
              "Bir parite için mevcut komisyon kademelerini, o paritenin gerçekte nasıl işlem gördüğüyle karşılaştırmak.",
          },
          {
            name: "Aralık emirleri",
            summary:
              "Fiyat bir bandın içinden geçerken tek taraflı pozisyonla iki token arasında dönüşüm yapmak.",
          },
        ],
      },
      {
        version: "Uniswap v4",
        features: [
          {
            name: "Hook keşfi",
            summary:
              "Bir hedefe uygun yayımlanmış hook'ları bulmak ve sınırlarını açıkça belirtmek.",
          },
          {
            name: "Dinamik komisyon hook'ları",
            summary:
              "Piyasa koşullarına tepki veren bir komisyonun getirdiği karmaşıklığa ne zaman değdiğini anlamak.",
          },
          {
            name: "TWAMM tarzı stratejiler",
            summary:
              "Büyük bir emri tek bir likidite noktasına karşı yürütmek yerine zamana yaymak.",
          },
        ],
      },
    ],
    footer:
      "Yukarıdaki planlanan kapsam henüz kurulmadı: yapay zekâ yorumu, kalıcı depolama ve cüzdan bağlantısı yok. Bugün çalışan kısım, doğrulanmış veri ve deterministik hesap yarısı — danışman bunun üzerine kuruluyor ki üst katmanlardaki hiçbir şey bir sayı uyduramasın. Danışman yalnızca öneri üretir; senin adına asla bir işlem imzalamaz veya göndermez.",
  },

  pool: {
    back: "← Uniswap Strateji Danışmanı",
    addressLabel: "Ethereum mainnet Uniswap v3 havuz adresi",
    analyse: "Analiz et",
    addressHelp:
      "Token adresi değil, havuz sözleşmesinin kendi adresi. Salt okunur: bu uygulama asla cüzdan bağlamaz ve işlem göndermez.",
    invalidAddress:
      "Bu bir Ethereum adresi değil. Adres, 0x ile başlayıp tam olarak 40 onaltılık karakterle devam eder.",
    loading: "Havuz verisi okunuyor…",
  },

  report: {
    steps: {
      pool: "havuzun yapılandırması okunurken",
      snapshot: "havuzun güncel piyasa durumu okunurken",
      history: "havuzun günlük fiyat geçmişi okunurken",
      volatility: "tarihsel volatilite ölçülürken",
      band: "fiyat bandı kurulurken",
      range: "bant havuzun tick ızgarasına hizalanırken",
    },
    noRangeHeading: "Bu havuz için aralık yok",
    stoppedWhile: (step: string) => `İşlem ${step} durdu.`,
    poolSummary: (feeTier: string, tickSpacing: string) =>
      `Ethereum mainnet üzerinde Uniswap v3 · ${feeTier} komisyon kademesi · tick aralığı ${tickSpacing}`,
    caveatsHeading: (count: number) =>
      count === 1
        ? "Bu sayılar için bir çekince geçerli."
        : `Bu sayılar için ${count} çekince geçerli.`,
    caveatsAriaLabel: "Çekinceler",

    rangeHeading: "Önerilen tick aralığı",
    lowerTick: "Alt tick",
    upperTick: "Üst tick",
    priceAt: (price: string, quote: string, base: string) =>
      `Fiyat: ${base} başına ${price} ${quote}`,
    width: "Genişlik",
    widthValue: (ticks: string) => `${ticks} tick`,
    widthNote: (spacings: string, tickSpacing: string) =>
      `${tickSpacing}'lik ${spacings} aralık`,
    inRange: "Şu an aralık içinde",
    yes: "Evet",
    no: "Hayır",
    inRangeNote: "Havuzun güncel tick'i bu sınırların içinde.",
    outOfRangeNote:
      "Burada kurulan bir pozisyon tek token tutar ve fiyat dönene kadar hiçbir şey kazanmaz.",
    lowerEdge: "Alt kenar",
    upperEdge: "Üst kenar",
    truncated: "Kırpıldı",
    asAsked: "İstendiği gibi",
    lowerTruncatedNote: "Bu havuzun kabul ettiği en düşük tick'te durdu.",
    upperTruncatedNote: "Bu havuzun kabul ettiği en yüksek tick'te durdu.",

    currentStateHeading: "Güncel durum",
    tokenPrice: (symbol: string) => `${symbol} fiyatı`,
    quotePerBase: (quote: string, base: string) => `${base} başına ${quote}`,
    currentTick: "Güncel tick",
    sourceReportedTick: (tick: string) => `Kaynak ${tick} bildirdi.`,
    noSourceTick:
      "Kaynak kendi tick'ini bildirmedi, bu yüzden bu dönüşüm doğrulanmadı.",
    tvl: "Kilitli toplam değer",
    sourceBlock: "Kaynak blok",
    noBlockTime: "Blok zamanı bildirilmedi.",
    fetchedAt: "Çekilme zamanı",
    fetchedAtNote: "Yanıtın geldiği an — anlattığı an değil.",

    volatilityHeading: "Tarihsel volatilite",
    annualised: "Yıllıklandırılmış",
    annualisedNote:
      "Günlük log getirilerinin örneklem standart sapması, sqrt(365) ile ölçeklenmiş.",
    daily: "Günlük",
    window: "Pencere",
    windowNote: (returns: string) => `${returns} kullanılabilir günlük getiri.`,
    coverage: "Kapsama",
    coverageNote: "Pencerenin ne kadarının ardışık günlük fiyatlarla desteklendiği.",

    bandHeading: "Bu aralığın türediği fiyat bandı",
    horizon: "Ufuk",
    horizonValue: (days: string) => `${days} gün`,
    horizonNote: "Bandın ne kadar ileriye ölçeklendiği.",
    multiplier: "Çarpan",
    multiplierNote: "Ufuk standart sapması sayısı — güven düzeyi değil.",
    lowerBound: "Alt sınır",
    upperBound: "Üst sınır",
    downside: "Aşağı yön",
    downsideNote: "Güncel fiyattan alt sınıra olan mesafe.",
    upside: "Yukarı yön",
    upsideNote: "Güncel fiyattan üst sınıra olan mesafe.",

    epilogue:
      "Bant log uzayında simetriktir; bu da onu yüzde cinsinden bilerek asimetrik yapar: fiyatın yarıya inmesiyle iki katına çıkması logaritmik olarak aynı mesafedir ve bunlardan yalnızca biri “%50”'dir. Bant beklenen getiriyi sıfır varsayar, fiyatın geçmişte ne kadar hareket ettiğini anlatır ve bir tahmin değildir. Çarpan bir güven düzeyi değildir. Buradaki hiçbir şey pozisyon büyüklüğü belirlemez, hangi tokendan ne kadar yatırılacağını söylemez.",
  },

  rateLimited: {
    title: "Çok fazla istek",
    body: (limit: number) =>
      `Bu sayfa her ziyarette canlı Uniswap verisi okuduğu için dakikada ${limit} analizle sınırlı.`,
    retry: (seconds: number) => `${seconds} saniye sonra tekrar dene.`,
    back: "Danışmana dön",
  },
};

const dictionaries: Record<Locale, Dictionary> = { en, tr };

export const getDictionary = (locale: Locale): Dictionary => dictionaries[locale];
