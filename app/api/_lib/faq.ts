/**
 * Static FAQ — the degrade path for /api/explain.
 *
 * AMENDMENT_02 §2 requires the explainer to "degrade to a static FAQ on
 * failure". These answers quote no figures at all, so the fallback can never
 * contradict the engine even in principle.
 */
import type { Lang } from "../../../engine/types.ts";

type Topic = "green" | "blue" | "grey" | "score" | "why_high" | "swap" | "season" | "default";

const ANSWERS: Record<Topic, Record<Lang, string>> = {
  green: {
    en: "Green water is rainfall stored in the soil that a crop takes up as it grows. It was never pumped or diverted, so it puts no pressure on rivers or groundwater.",
    hi: "हरा पानी वह वर्षा जल है जो मिट्टी में संचित रहता है और फसल उसे बढ़ते हुए सोखती है। यह न पंप किया जाता है न मोड़ा जाता है, इसलिए नदियों या भूजल पर दबाव नहीं डालता।",
    mr: "हिरवे पाणी म्हणजे मातीत साठलेले पावसाचे पाणी, जे पीक वाढताना शोषून घेते. ते उपसले जात नाही, त्यामुळे नद्या किंवा भूजलावर ताण येत नाही.",
    ta: "பச்சை நீர் என்பது மண்ணில் தேங்கிய மழைநீர்; பயிர் வளரும்போது அதை உறிஞ்சுகிறது. அது இறைக்கப்படுவதில்லை, எனவே ஆறுகளுக்கோ நிலத்தடி நீருக்கோ அழுத்தம் தருவதில்லை.",
  },
  blue: {
    en: "Blue water is irrigation — water taken from rivers, canals or groundwater. This is the part that competes with drinking water and with the aquifer under the farm.",
    hi: "नीला पानी सिंचाई का पानी है — नदियों, नहरों या भूजल से लिया गया। यही हिस्सा पीने के पानी और खेत के नीचे के जलभृत से प्रतिस्पर्धा करता है।",
    mr: "निळे पाणी म्हणजे सिंचनाचे पाणी — नद्या, कालवे किंवा भूजलातून घेतलेले. हाच भाग पिण्याच्या पाण्याशी आणि शेताखालील जलधराशी स्पर्धा करतो.",
    ta: "நீல நீர் என்பது பாசன நீர் — ஆறுகள், கால்வாய்கள் அல்லது நிலத்தடியிலிருந்து எடுக்கப்படுவது. இதுவே குடிநீருடனும் நிலத்தடி நீருடனும் போட்டியிடுகிறது.",
  },
  grey: {
    en: "Grey water is not water used by the crop. It is an estimate of how much clean water would be needed to dilute the fertiliser and pesticide runoff back to a safe standard.",
    hi: "धूसर पानी फसल द्वारा प्रयुक्त पानी नहीं है। यह अनुमान है कि उर्वरक और कीटनाशक बहाव को सुरक्षित स्तर तक घोलने के लिए कितना स्वच्छ पानी चाहिए।",
    mr: "करडे पाणी हे पिकाने वापरलेले पाणी नाही. खत आणि कीटकनाशकांचा प्रवाह सुरक्षित पातळीपर्यंत विरळ करण्यासाठी किती स्वच्छ पाणी लागेल याचा तो अंदाज आहे.",
    ta: "சாம்பல் நீர் பயிர் பயன்படுத்திய நீர் அல்ல. உரம், பூச்சிக்கொல்லி கழிவை பாதுகாப்பான அளவுக்குக் கரைக்க எவ்வளவு சுத்தமான நீர் தேவை என்ற மதிப்பீடு.",
  },
  score: {
    en: "The score ranks this item's irrigation and pollution water against the whole catalogue, after weighting irrigation by how stressed the groundwater is where it grew. Rainfall the crop absorbed in place is excluded — it competes with nobody, so a rain-fed crop is not penalised for drinking rain. 0 is the lightest, 100 the heaviest.",
    hi: "यह स्कोर इस वस्तु की तुलना हमारी पूरी सूची से करता है, इसके सिंचाई जल को उस क्षेत्र के भूजल दबाव के अनुसार भारित करके। 0 सबसे हल्का, 100 सबसे भारी।",
    mr: "हा गुण या वस्तूची तुलना आमच्या संपूर्ण यादीशी करतो, तिचे सिंचन पाणी ते जिथे पिकले तिथल्या भूजल ताणानुसार भारित करून. 0 सर्वात हलके, 100 सर्वात जड.",
    ta: "இந்த மதிப்பெண் இப்பொருளை எங்கள் முழுப் பட்டியலுடன் ஒப்பிடுகிறது — பயிரிடப்பட்ட இடத்தின் நிலத்தடி நீர் அழுத்தத்தின்படி பாசன நீரை எடைபோட்ட பிறகு. 0 மிக இலகுவானது, 100 மிகக் கனமானது.",
  },
  why_high: {
    en: "Usually one of three reasons: the crop needs a lot of irrigation, a large share of it is grown where groundwater is over-drawn, or a lot of raw crop is needed for a small amount of finished product.",
    hi: "आमतौर पर तीन में से एक कारण: फसल को बहुत सिंचाई चाहिए, इसका बड़ा हिस्सा वहाँ उगता है जहाँ भूजल अधिक निकाला जाता है, या थोड़े तैयार उत्पाद के लिए बहुत कच्ची फसल चाहिए।",
    mr: "साधारणपणे तीनपैकी एक कारण: पिकाला भरपूर सिंचन लागते, त्याचा मोठा भाग भूजल जास्त उपसल्या जाणाऱ्या भागात पिकतो, किंवा थोड्या तयार उत्पादनासाठी खूप कच्चे पीक लागते.",
    ta: "பொதுவாக மூன்றில் ஒரு காரணம்: பயிருக்கு அதிக பாசனம் தேவை, அதன் பெரும் பகுதி நிலத்தடி நீர் அதிகம் எடுக்கப்படும் இடத்தில் விளைகிறது, அல்லது சிறிதளவு பொருளுக்கு அதிக மூலப்பயிர் தேவை.",
  },
  swap: {
    en: "A swap is suggested only when the alternative genuinely draws less irrigation water for the same weight. If no alternative saves water, no suggestion is shown.",
    hi: "विकल्प तभी सुझाया जाता है जब वह उसी वज़न के लिए वास्तव में कम सिंचाई जल लेता हो। यदि कोई विकल्प पानी नहीं बचाता, तो कोई सुझाव नहीं दिखाया जाता।",
    mr: "पर्याय तेव्हाच सुचवला जातो जेव्हा तो त्याच वजनासाठी खरोखर कमी सिंचन पाणी घेतो. कोणताही पर्याय पाणी वाचवत नसेल, तर सूचना दाखवली जात नाही.",
    ta: "மாற்று ஒன்று அதே எடைக்கு உண்மையிலேயே குறைவான பாசன நீரை எடுக்கும்போது மட்டுமே பரிந்துரைக்கப்படுகிறது. எந்த மாற்றும் நீரைச் சேமிக்கவில்லை என்றால் பரிந்துரை காட்டப்படாது.",
  },
  season: {
    en: "Season changes the split between rainfall and irrigation, not the total. A monsoon-sown kharif crop gets much of its water free from rain; a rabi or summer crop leans on irrigation instead.",
    hi: "मौसम वर्षा और सिंचाई के बीच का बँटवारा बदलता है, कुल नहीं। मानसून में बोई खरीफ फसल को बहुत पानी वर्षा से मुफ़्त मिलता है; रबी या गर्मी की फसल सिंचाई पर निर्भर रहती है।",
    mr: "हंगाम पाऊस आणि सिंचन यांच्यातील वाटप बदलतो, एकूण नाही. पावसाळ्यात पेरलेल्या खरीप पिकाला बरेच पाणी पावसातून फुकट मिळते; रब्बी किंवा उन्हाळी पीक सिंचनावर अवलंबून असते.",
    ta: "பருவம் மொத்தத்தை மாற்றுவதில்லை; மழைக்கும் பாசனத்திற்கும் இடையிலான பங்கை மாற்றுகிறது. பருவமழையில் விதைக்கும் காரிஃப் பயிர் நீரின் பெரும்பகுதியை மழையிலிருந்து இலவசமாகப் பெறுகிறது; ரபி அல்லது கோடைப் பயிர் பாசனத்தை நம்பியிருக்கிறது.",
  },
  default: {
    en: "The explainer is unavailable right now, so I can only answer from a fixed set of notes. Everything shown on the result screen is still accurate — it comes straight from the calculation, not from me.",
    hi: "व्याख्याकार अभी उपलब्ध नहीं है, इसलिए मैं केवल निश्चित टिप्पणियों से उत्तर दे सकता हूँ। परिणाम स्क्रीन पर दिखाया गया सब कुछ अब भी सही है — वह सीधे गणना से आता है, मुझसे नहीं।",
    mr: "स्पष्टीकरण देणारा सध्या उपलब्ध नाही, त्यामुळे मी ठराविक टिपांमधूनच उत्तर देऊ शकतो. निकाल स्क्रीनवर दिसणारे सर्व अजूनही अचूक आहे — ते थेट गणनेतून येते, माझ्याकडून नाही.",
    ta: "விளக்கமளிப்பான் இப்போது கிடைக்கவில்லை, எனவே நிலையான குறிப்புகளிலிருந்து மட்டுமே பதிலளிக்க முடியும். முடிவுத் திரையில் காட்டப்படுவது அனைத்தும் இன்னும் சரியானதே — அது கணக்கீட்டிலிருந்து நேரடியாக வருகிறது, என்னிடமிருந்து அல்ல.",
  },
};

const KEYWORDS: [Topic, RegExp][] = [
  ["green", /green water|हरा पानी|हिरवे पाणी|பச்சை நீர்/i],
  ["blue", /blue water|irrigation|नीला पानी|सिंचाई|निळे पाणी|सिंचन|நீல நீர்|பாசன/i],
  ["grey", /grey water|gray water|pollut|धूसर|करडे|प्रदूषण|சாம்பல்|மாசு/i],
  ["score", /score|rank|percentile|स्कोर|गुण|மதிப்பெண்/i],
  ["season", /season|month|kharif|rabi|मौसम|महीना|हंगाम|பருவ|மாத/i],
  ["swap", /swap|alternative|instead|विकल्प|बदल|पर्याय|மாற்று/i],
  ["why_high", /why.*(high|more|big)|so much|क्यों.*ज़्यादा|इतना|का ज्यादा|ஏன்.*அதிக/i],
];

export function staticFallback(question: string, lang: Lang): string {
  for (const [topic, pattern] of KEYWORDS) {
    if (pattern.test(question)) return ANSWERS[topic][lang];
  }
  return ANSWERS.default[lang];
}
