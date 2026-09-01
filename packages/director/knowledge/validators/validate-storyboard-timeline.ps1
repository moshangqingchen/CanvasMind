param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [ValidateSet("Text", "Json")]
    [string]$Format = "Text"
)

$ErrorActionPreference = "Stop"
$epsilon = 0.001
$allowedStoryFunctionTypes = @(
    "dialogue",
    "action",
    "information",
    "relationship",
    "emotion",
    "space",
    "evidence",
    "sound",
    "continuity"
)
$allowedShotKinds = @("action", "dialogue", "reaction", "transition", "establishing", "insert", "montage")
$allowedSpeedBranches = @("action_speed", "camera_speed", "effect_response_speed")
$allowedPlaybackSpeeds = @("real-time", "slow-motion", "fast-motion")
$allowedMovementModes = @("physical", "teleportation")
$allowedMotionMotivations = @("user-request", "reference-bound", "story-causality")
$allowedFightSequenceModes = @("multi-shot", "dynamic-long-take")
$allowedFightScopes = @("complete-sequence", "isolated-beat")
$allowedFightBeatPhases = @("attack", "response", "result")
$allowedFightStateChanges = @("offense", "defense", "space", "dominance", "objective", "injury", "resource", "ability-rule")
$allowedFightShotRoles = @("space-establish", "pursuit-evasion", "contact-clarity", "impact-reception", "reversal-reveal", "result-reframe")
$allowedFightReferenceLanes = @("current-short-form", "long-form-visual")
$allowedFightReferenceMedia = @("short-video", "anime", "film")
$allowedObservedRangeCreationModes = @("human-directed", "ai-generated", "origin-unverified")
$allowedFightReferenceUseModes = @("internal-study", "licensed-recreation", "publishable-translation")
$fillerPattern = '(?i)(?:\bfillers?\b|\bpadding\b|\bpadded\b|\bduration[-_ ]*padding\b|breathing[-_ ]*only|reaction[-_ ]*only|microdynamics[-_ ]*only|standalone\s+reaction|(?:stretch|extend)[^.!?;\r\n]{0,20}(?:target\s+duration|\d+(?:\.\d+)?\s*seconds?)|(?:reach|make\s+up)[^.!?;\r\n]{0,12}target\s+duration|\u51d1\u65f6\u957f|\u586b(?:\u5145)?\u65f6\u957f|(?:\u62c9\u957f|\u5ef6\u957f)[^\u3002\uff01\uff1f\uff1b;\r\n]{0,20}(?:\u76ee\u6807(?:\u65f6\u957f|\u79d2\u6570)|\d+(?:\.\d+)?\s*\u79d2)|(?:\u8fbe\u5230|\u8865\u8db3)[^\u3002\uff01\uff1f\uff1b;\r\n]{0,12}\u76ee\u6807(?:\u65f6\u957f|\u79d2\u6570)|\u7eaf\u53cd\u5e94|\u7eaf\u547c\u5438|\u7a7a\u955c\u586b\u5145|\u4ec5\u73af\u5883\u5fae\u52a8)'
$reactionAliasPattern = '(?i)(?:\breaction(?:[-_ ]?(?:beat|shot|cutaway|hold))?\b|\breact(?:[-_ ]?(?:beat|shot))?\b|\bresponse[-_ ]?(?:beat|shot|reaction)\b|\u53cd\u5e94(?:\u955c\u5934|\u8282\u62cd|\u62cd|\u505c\u987f)?)'
$forbiddenPropertyNamePattern = '(?i)(?:filler|padding|padded|durationpadding|\u51d1\u65f6\u957f|\u586b(?:\u5145)?\u65f6\u957f|\u7eaf\u53cd\u5e94|\u7a7a\u955c\u586b\u5145)'
$motionSemanticPropertyPattern = '(?i)^(?:action|action[-_ ]?speed|performance|movement|motion|subject[-_ ]?(?:movement|motion|speed)|camera|camera[-_ ]?(?:movement|motion|speed)|effect|effects|vfx|effect[-_ ]?(?:response[-_ ]?)?(?:movement|motion|speed)|environment|environment[-_ ]?(?:response[-_ ]?)?(?:movement|motion|speed)|speed|description|prompt|video[-_ ]?prompt|shot[-_ ]?prompt|motion[-_ ]?prompt|blocking|staging|choreography)$'
$genericExecutionPropertyPattern = '(?i)^(?:description|prompt|video[-_ ]?prompt|shot[-_ ]?prompt|motion[-_ ]?prompt|blocking|staging|choreography)$'
$strongSpeedCuePattern = '(?i)(?:\b(?:ultra[- ]?fast|extreme(?:ly)?[- ]fast|high[- ]speed|rapid(?:ly)?|fast(?:er)?|slow(?:ly|er)?|slow[- ]motion|fast[- ]motion|slow[- ]playback|fast[- ]playback|speed[- ]ramp(?:ing)?|time[- ]?remap(?:ping)?|frame[- ]?(?:skip|skipping)|time[- ]?lapse|timelapse|undercrank(?:ed|ing)?|overcrank(?:ed|ing)?|accelerat(?:e|es|ed|ing|ion)|decelerat(?:e|es|ed|ing|ion))\b|\u6781\u901f|\u8d85\u9ad8\u901f|\u9ad8\u901f(?!\u516c\u8def|\u94c1\u8def|\u8def\u6bb5)|\u5feb\u901f(?!\u8def)|\u6781\u6162|\u6162\u901f|\u7f13\u6162|\u6162\u6162|\u6162\u52a8\u4f5c|\u6162\u653e|\u5feb\u52a8\u4f5c|\u5feb\u653e|\u52a0\u901f\u64ad\u653e|\u901f\u5ea6\u6e10\u53d8|\u53d8\u901f|\u62bd\u5e27|\u8df3\u5e27|\u5ef6\u65f6\u6444\u5f71|\u7f29\u65f6|\u5347\u683c|\u964d\u683c|\u9aa4\u7136\u52a0\u901f|\u77ac\u65f6\u52a0\u901f|\u7206\u53d1\u5f0f\u52a0\u901f|\u52a0\u901f(?!\u5668)|\u51cf\u901f(?!\u5e26|\u5668))'
$isolatedSpeedAdjectivePattern = '(?i)^(?:\u5feb|\u5feb\u901f|\u6781\u901f|\u8d85\u9ad8\u901f|\u9ad8\u901f|\u6162|\u6162\u901f|\u6781\u6162|\u7f13\u6162|fast|rapid|rapidly|slow|slowly)[\s.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a-]*$'
$speedPhaseSignalPattern = '(?i)(?:\b(?:start|onset|accelerate|acceleration|peak|cruise|constant|decelerate|deceleration|settle|stop|contact|trigger|recover|return)\b|\u8d77\u6b65|\u542f\u52a8|\u52a0\u901f|\u5cf0\u503c|\u5300\u901f|\u51cf\u901f|\u505c\u7a33|\u505c\u6b62|\u63a5\u89e6|\u89e6\u53d1|\u56de\u843d|\u6062\u590d)'
$slowMotionPattern = '(?i)(?:\bslow[- ]?(?:motion|playback)\b|\u6162\u52a8\u4f5c|\u6162\u653e|\u5347\u683c)'
$playbackRemapCuePattern = '(?i)(?:\b(?:slow|fast)(?:[- ]?(?:motion|playback))?\b|\bspeed[- ]ramp(?:ing)?\b|\btime[- ]?remap(?:ping)?\b|\bframe[- ]?(?:skip|skipping)\b|\btime[- ]?lapse\b|\btimelapse\b|\bundercrank(?:ed|ing)?\b|\bovercrank(?:ed|ing)?\b|\u6162\u52a8\u4f5c|\u6162\u653e|\u5feb\u653e|\u52a0\u901f\u64ad\u653e|\u901f\u5ea6\u6e10\u53d8|\u53d8\u901f|\u62bd\u5e27|\u8df3\u5e27|\u5ef6\u65f6\u6444\u5f71|\u7f29\u65f6|\u5347\u683c|\u964d\u683c)'
$playbackReturnPattern = '(?i)(?:\b(?:return(?:s|ed|ing)?|resume(?:s|d|ing)?|switch(?:es|ed|ing)?|back)\b[^.!?;\r\n]{0,16}\breal[- ]?time\b|(?:\u6062\u590d|\u56de\u5230|\u8f6c\u56de)(?:\u4e3a|\u5230)?(?:\u5b9e\u65f6|\u6b63\u5e38\u901f\u5ea6|\u539f\u901f))'
$playbackReturnNegationPattern = '(?i)(?:(?:never|not|no|without|cannot|can''t|won''t|do\s+not)[^.!?;\r\n]{0,20}(?:return|resume|switch|real[- ]?time)|(?:\u4e0d|\u672a|\u7981\u6b62|\u65e0\u6cd5|\u4e0d\u4f1a|\u6c38\u4e0d)[^\u3002\uff01\uff1f\uff1b;\r\n]{0,16}(?:\u6062\u590d|\u56de\u5230|\u8f6c\u56de|\u5b9e\u65f6|\u6b63\u5e38\u901f\u5ea6|\u539f\u901f))'
$teleportCuePattern = '(?i)(?:\bteleport(?:ation|ed|ing)?\b|\bteleport[- ]?like\b|\binstantaneous\s+displacement\b|\u77ac\u79fb|\u77ac\u95f4\u6362\u4f4d|\u77ac\u95f4\u79fb\u52a8|\u76f4\u63a5\u6362\u4f4d|\u95ea\u73b0)'
$teleportNegationPattern = '(?i)(?:(?:\u7981\u6b62|\u4e0d\u4f7f\u7528|\u4e0d\u5f97|\u4e0d\u80fd|\u4e0d\u53ef|\u907f\u514d|\u4e0d\u662f|\u5e76\u975e|\u4e0d\u50cf|\u975e|\u4e0d\u8981)[^\u3002\uff01\uff1f\uff1b;\r\n]{0,20}(?:\u77ac\u79fb|\u77ac\u95f4\u6362\u4f4d|\u77ac\u95f4\u79fb\u52a8|\u76f4\u63a5\u6362\u4f4d|\u95ea\u73b0)|(?:without|avoid|forbid(?:den)?|do\s+not|not|no|isn''t|is\s+not)[^.!?;\r\n]{0,20}(?:teleport(?:ation)?|instantaneous\s+displacement))'
$speedPlaceholderPattern = '(?i)^(?:none|never|null|nil|n\s*[/\\._-]?\s*a|tbd|todo|pending|placeholder|whenever|forever|not\s+applicable|not\s+available|nothing|no(?:thing)?|\u65e0|\u6ca1\u6709|\u6c38\u4e0d|\u4ece\u4e0d|\u672a\u5b9a|\u5f85\u5b9a|\u6682\u65e0|\u4e0d\u9002\u7528|\u5360\u4f4d|\u7a7a)[\s.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a-]*$'
$genericPlaybackStoryPattern = '(?i)^(?:cinematic|dramatic|emphasis|impact|style|mood|\u7535\u5f71\u611f|\u9ad8\u7ea7\u611f|\u5f3a\u8c03|\u51b2\u51fb|\u6c1b\u56f4)[\s.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a-]*$'
$falseJustificationPattern = '(?i)^(?:none|null|nil|n\s*[/\\._-]?\s*a|not\s+applicable|not\s+available|no\s+(?:change|state\s+change|exit(?:\s+point)?|event|action)|nothing(?:\s+(?:changes?|happens?|occurs?))?|unchanged|same(?:\s+as\s+before)?|not\s+(?:happened|occurred)|\u65e0|\u6ca1\u6709|\u65e0\u53d8\u5316|\u672a\u53d1\u751f|\u672a\u6539\u53d8|\u4e0d\u53d8|\u6682\u65e0|\u4e0d\u9002\u7528|\u7a7a|\u540c\u524d|\u7167\u65e7|\u4fdd\u6301\u4e0d\u53d8)(?:[\s.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a-].*)?$'
$genericJustificationPattern = '(?i)^(?:state\s+change|actual\s+change|change\s+(?:happens?|occurs?)|something\s+(?:changes?|happens?|occurs?)|exit\s+point|clear\s+exit|\u72b6\u6001\u53d8\u5316|\u5b9e\u9645\u53d8\u5316|\u53d1\u751f\u53d8\u5316|\u6709\u53d8\u5316|\u51fa\u70b9|\u660e\u786e\u51fa\u70b9|\u6709\u51fa\u70b9)[\s.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a-]*$'
$stateChangeSignalPattern = '(?i)(?:\bfrom\b.+\bto\b|\b(?:begin|start|stop|end|change|shift|turn|move|reach|open|close|rise|fall|drop|grab|release|look|glance|step|speak|answer|decide|commit|recognize|realize|reveal|appear|disappear|activate|deactivate|break|switch|enter|exit|hit|land|sound|flash|light|become|replace|constrict|widen|slam|fire|pull|push|nod|freeze|relax|tighten|harden)(?:s|es|ed|ing)?\b|\u4ece.+(?:\u5230|\u53d8\u4e3a|\u8f6c\u4e3a).+|\u7531.+(?:\u53d8\u4e3a|\u8f6c\u4e3a|\u5230).+|(?:\u5f00\u59cb|\u505c\u6b62|\u7ed3\u675f|\u6539\u53d8|\u53d8\u5316|\u8f6c\u5411|\u79fb\u52a8|\u4f38\u624b|\u6293\u4f4f|\u677e\u5f00|\u62ac\u5934|\u4f4e\u5934|\u8d77\u8eab|\u5750\u4e0b|\u5f00\u53e3|\u56de\u7b54|\u51b3\u5b9a|\u786e\u8ba4|\u53d1\u73b0|\u610f\u8bc6|\u663e\u9732|\u51fa\u73b0|\u6d88\u5931|\u542f\u52a8|\u5173\u95ed|\u65ad\u88c2|\u5207\u6362|\u8fdb\u5165|\u79bb\u5f00|\u51fb\u4e2d|\u843d\u5730|\u54cd\u8d77|\u95ea\u70c1|\u4eae\u8d77|\u7184\u706d|\u653e\u677e|\u7ef7\u7d27))'
$exitPointSignalPattern = '(?i)(?:\b(?:when|once|after|before|until|then|next|into|cut|cuts|transition|transitions|handoff|hand-off|begin|start|stop|end|turn|reach|open|close|answer|reveal|enter|exit|hit|land|slam|fire|release|commit)(?:s|es|ed|ing)?\b|\u4ece.+(?:\u5207\u5230|\u8f6c\u5165|\u8fdb\u5165).+|(?:\u5f53|\u4e00\u65e6|\u76f4\u5230|\u968f\u5373|\u968f\u540e|\u6b64\u65f6|\u4e4b\u540e|\u4e4b\u524d|\u4e0b\u4e00|\u51fa\u70b9|\u5207\u5230|\u8f6c\u5165|\u63a5\u5165|\u89e6\u53d1|\u5b8c\u6210|\u843d\u70b9|\u5f00\u59cb|\u7ed3\u675f|\u6253\u5f00|\u5173\u95ed|\u56de\u7b54|\u663e\u9732|\u8fdb\u5165|\u79bb\u5f00|\u51fb\u4e2d|\u843d\u5730|\u54cd\u8d77))'
$fightPlaceholderPattern = '(?i)^(?:none|null|nil|n\s*[/\\._-]?\s*a|tbd|todo|pending|placeholder|not\s+(?:applicable|available)|nothing|unknown|same|unchanged|generic|make\s+it\s+(?:exciting|cinematic|dynamic)|show(?:case)?\s+(?:the\s+)?(?:fight|battle|combat)|fight\s+continues?|\u65e0|\u6ca1\u6709|\u672a\u5b9a|\u5f85\u5b9a|\u6682\u65e0|\u4e0d\u9002\u7528|\u5360\u4f4d|\u7a7a|\u540c\u524d|\u4e0d\u53d8|\u672a\u77e5|\u7cbe\u5f69|\u7535\u5f71\u611f|\u52a8\u6001\u955c\u5934|\u5c55\u793a\u6253\u6597|\u7ee7\u7eed\u6253\u6597)[\s.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a-]*$'
$fightNoProgressPattern = '(?i)(?:\b(?:continue|continues|continued|continuing|repeat|repeats|repeated|repeating)\b[^.!?;\r\n]{0,36}\b(?:same|unchanged|clash|attack|move|strike|exchange)\b|\b(?:no|without)\s+(?:real\s+)?(?:change|progress|result|consequence)\b|\b(?:situation|spacing|advantage|pressure|state)\s+(?:stays?|remains?)\s+(?:the\s+)?same\b|\bonly\s+(?:the\s+)?(?:angle|particles?|brightness|bloom|orbit)\s+(?:change|changes|increase|increases)\b|\u7ee7\u7eed(?:\u5bf9\u8f70|\u540c\u4e00\u62db|\u653b\u51fb|\u6253\u6597)|\u5c40\u52bf\u4e0d\u53d8|\u72b6\u6001\u4e0d\u53d8|\u4f18\u52bf\u4e0d\u53d8|\u53ea(?:\u6362\u89d2\u5ea6|\u589e\u52a0(?:\u7c92\u5b50|\u4eae\u5ea6)|\u63d0\u9ad8(?:\u7c92\u5b50|\u4eae\u5ea6))|\u91cd\u590d\u7206\u5149)'
$fightResultProgressPattern = '(?i)(?:\b(?:new|change|changes|changed|shift|shifts|shifted|move|moves|moved|displace|displaces|displaced|force|forces|forced|redirect|redirects|redirected|break|breaks|broken|open|opens|opened|close|closes|closed|lose|loses|lost|gain|gains|gained|damage|damages|damaged|injure|injures|injured|deplete|depletes|depleted|spend|spends|spent|trap|traps|trapped|escape|escapes|escaped|fall|falls|fallen|drop|drops|dropped|recover|recovers|recovered|advantage|control|position|distance|route|rule|resource|injury|wound|stagger|staggered|knock|knocked|crack|cracked|shatter|shattered)\b|\u65b0(?:\u4f4d\u7f6e|\u8ddd\u79bb|\u4f18\u52bf|\u8def\u7ebf|\u72b6\u6001)|\u6539\u53d8|\u53d8\u4e3a|\u8f6c\u79fb|\u4f4d\u79fb|\u903c\u9000|\u51fb\u9000|\u5931\u53bb|\u83b7\u5f97|\u53d7\u4f24|\u7834\u574f|\u6253\u7834|\u5f00\u542f|\u5173\u95ed|\u8017\u5c3d|\u6d88\u8017|\u7ed3\u679c|\u540e\u679c)'
$unqualifiedFightCameraPattern = '(?i)(?:\b(?:decorative|aimless|unmotivated|passive|unchanged)\b[^.!?;\r\n]{0,40}\b(?:orbit|circle|drift|float|push|pull|camera|observe|watch)\b|\b(?:orbit|circle|drift|float)\b[^.!?;\r\n]{0,40}\b(?:decorative|aimless|unmotivated|unchanged|same\s+distance|constant\s+distance|no\s+change)\b|\b(?:fixed|static)\s+(?:camera|observation|view)\b[^.!?;\r\n]{0,30}\b(?:whole|entire|throughout|unchanged|passive)\b|\u65e0\u76ee\u7684(?:\u73af\u7ed5|\u6f02\u79fb|\u63a8\u62c9)|\u88c5\u9970\u6027(?:\u73af\u7ed5|\u63a8\u62c9)|\u56fa\u5b9a\u673a\u4f4d[^\u3002\uff01\uff1f\uff1b;\r\n]{0,24}(?:\u5168\u7a0b|\u6574\u6bb5|\u6301\u7eed\u89c2\u5bdf)|\u4fdd\u6301\u76f8\u540c\u8ddd\u79bb(?:\u73af\u7ed5|\u6f02\u79fb))'
$fightCameraTransitionSignalPattern = '(?i)(?:\b(?:descend|ascend|rise|drop|cross|retreat|advance|shift|move|track|follow|dolly|pan|tilt|crane|duck|sidestep|correct|settle|reframe|rotate|arc|orbit|decelerate|accelerate|pull|push|change\s+(?:height|position|distance|orientation|speed))\b|\u4e0b\u964d|\u4e0a\u5347|\u8de8\u8d8a|\u540e\u9000|\u524d\u8fdb|\u79fb\u4f4d|\u8ddf\u968f|\u8ffd\u968f|\u6447\u955c|\u4fef\u4ef0|\u5347\u964d|\u95ea\u907f|\u4fa7\u79fb|\u4fee\u6b63|\u505c\u7a33|\u91cd\u6784|\u65cb\u8f6c|\u73af\u7ed5|\u51cf\u901f|\u52a0\u901f|\u63a8\u8fd1|\u62c9\u8fdc|\u6539\u53d8(?:\u9ad8\u5ea6|\u4f4d\u7f6e|\u8ddd\u79bb|\u671d\u5411|\u901f\u5ea6))'
$fightCameraTriggerSignalPattern = '(?i)(?:\b(?:attack|response|evade|dodge|parry|counter|contact|impact|pressure|reversal|danger|reveal|information|sound|gaze|look|movement|move|change|shift|break|entry|exit)\b|\u8fdb\u653b|\u5e94\u5bf9|\u95ea\u907f|\u683c\u6321|\u53cd\u51fb|\u63a5\u89e6|\u51b2\u51fb|\u538b\u529b|\u53cd\u8f6c|\u5371\u9669|\u63ed\u793a|\u4fe1\u606f|\u58f0\u97f3|\u89c6\u7ebf|\u52a8\u4f5c|\u53d8\u5316|\u8f6c\u79fb|\u7834\u574f|\u5165\u53e3|\u51fa\u53e3)'
$fightSemanticPattern = '(?i)(?:\bfight(?:ing)?\s+(?:sequence|scene|choreograph(?:y|ed)?|between)\b|\bbattle\s+(?:sequence|scene|choreograph(?:y|ed)?)\b|\bcombat\s+(?:sequence|scene|choreograph(?:y|ed)?)\b|\b(?:duel|brawl|melee|exchange\s+blows|power\s+clash|beam\s+clash|energy\s+clash)\b|\u6253\u6597|\u51b3\u6597|\u640f\u6597|\u683c\u6597|\u6fc0\u6218|\u4ea4\u950b|\u6218\u6597(?:\u573a\u9762|\u573a\u666f|\u5e8f\u5217|\u955c\u5934|\u63d0\u793a\u8bcd|\u52a8\u4f5c)|\u5bf9\u8f70|\u80fd\u91cf\u5bf9\u649e|\u5149\u675f\u5bf9\u51b2|\u5fc5\u6740\u6280\u5bf9\u649e)'
$powerClashPattern = '(?i)(?:\b(?:power|beam|energy)[-_ ]?clash\b|\bclashing\s+(?:beams?|powers?|energy)\b|\u5bf9\u8f70|\u80fd\u91cf\u5bf9\u649e|\u80fd\u91cf\u5bf9\u51b2|\u5149\u675f\u5bf9\u649e|\u5149\u675f\u5bf9\u51b2|\u5fc5\u6740\u6280\u5bf9\u649e)'

function Add-Issue {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [Parameter(Mandatory = $true)][string]$Rule,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Shot,
        [Parameter(Mandatory = $true)][string]$Message
    )

    [void]$Issues.Add([pscustomobject]@{
        rule = $Rule
        shot = $Shot
        message = $Message
    })
}

function Test-JsonObject {
    param($Value)
    return $Value -is [System.Management.Automation.PSCustomObject]
}

function Get-SemanticText {
    param($Value)

    if ($Value -isnot [string]) {
        return $null
    }
    $normalized = $Value.Normalize([System.Text.NormalizationForm]::FormKC)
    return ([regex]::Replace($normalized, '[\p{Cf}\p{Cc}]', '')).Trim()
}

function Test-MeaningfulString {
    param($Value)

    if ($Value -isnot [string]) {
        return $false
    }
    $text = Get-SemanticText -Value $Value
    return -not [string]::IsNullOrWhiteSpace($text)
}

function Test-ConcreteSpeedString {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }
    return (Get-SemanticText -Value $Value) -notmatch $speedPlaceholderPattern
}

function Test-ConcreteFightString {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }
    return (Get-SemanticText -Value $Value) -notmatch $fightPlaceholderPattern
}

function Test-FightRequiredTextField {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Field,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [Parameter(Mandatory = $true)][string]$Rule,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Path
    )

    if (-not (Test-JsonObject -Value $Object)) {
        return $false
    }
    $properties = @($Object.PSObject.Properties.Name)
    if ($properties -notcontains $Field -or -not (Test-ConcreteFightString -Value $Object.$Field)) {
        Add-Issue -Issues $Issues -Rule $Rule -Shot $Path -Message "$Field must be a concrete, semantically non-empty JSON string rather than a placeholder."
        return $false
    }
    return $true
}

function Test-FightRequiredStringArray {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Field,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [Parameter(Mandatory = $true)][string]$Rule,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Path
    )

    if (-not (Test-JsonObject -Value $Object)) {
        return $false
    }
    $properties = @($Object.PSObject.Properties.Name)
    if ($properties -notcontains $Field -or $Object.$Field -isnot [System.Array]) {
        Add-Issue -Issues $Issues -Rule $Rule -Shot $Path -Message "$Field must be a non-empty JSON array of concrete strings."
        return $false
    }
    $values = @($Object.$Field)
    if ($values.Count -eq 0 -or @($values | Where-Object { -not (Test-ConcreteFightString -Value $_) }).Count -gt 0) {
        Add-Issue -Issues $Issues -Rule $Rule -Shot $Path -Message "$Field must be a non-empty JSON array of concrete strings."
        return $false
    }
    return $true
}

function Test-HasAffirmativeTeleportCue {
    param($Value)

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }

    $text = Get-SemanticText -Value $Value
    $clauses = @([regex]::Split(
        $text,
        '(?i)(?:[\u3002\uff01\uff1f\uff1b;.!?,\uff0c]|\b(?:but|however|then|afterward)\b|(?:\u4f46\u662f|\u4f46|\u5374|\u968f\u540e|\u7136\u540e|\u800c\u540e|\u63a5\u7740))'
    ))
    foreach ($clause in $clauses) {
        if ($clause -match $teleportCuePattern -and $clause -notmatch $teleportNegationPattern) {
            return $true
        }
    }
    return $false
}

function Get-StringLeaves {
    param($Value, [string]$Path)

    if ($Value -is [string]) {
        [pscustomobject]@{ Path = $Path; Value = $Value }
        return
    }
    if ($Value -is [System.Array]) {
        for ($arrayIndex = 0; $arrayIndex -lt $Value.Count; $arrayIndex++) {
            Get-StringLeaves -Value $Value[$arrayIndex] -Path "$Path[$arrayIndex]"
        }
        return
    }
    if (Test-JsonObject -Value $Value) {
        foreach ($property in $Value.PSObject.Properties) {
            $childPath = if ([string]::IsNullOrEmpty($Path)) { $property.Name } else { "$Path.$($property.Name)" }
            Get-StringLeaves -Value $property.Value -Path $childPath
        }
    }
}

function Test-ContainsPlaybackRemapCue {
    param($Value)

    $leaves = @(Get-StringLeaves -Value $Value -Path "playback_speed")
    return @($leaves | Where-Object {
        (Get-SemanticText -Value $_.Value) -match $playbackRemapCuePattern
    }).Count -gt 0
}

function Get-JsonPropertyNodes {
    param($Value, [string]$Path)

    if ($Value -is [System.Array]) {
        for ($arrayIndex = 0; $arrayIndex -lt $Value.Count; $arrayIndex++) {
            Get-JsonPropertyNodes -Value $Value[$arrayIndex] -Path "$Path[$arrayIndex]"
        }
        return
    }
    if (Test-JsonObject -Value $Value) {
        foreach ($property in $Value.PSObject.Properties) {
            $childPath = if ([string]::IsNullOrEmpty($Path)) { $property.Name } else { "$Path.$($property.Name)" }
            [pscustomobject]@{ Path = $childPath; Name = $property.Name; Value = $property.Value }
            Get-JsonPropertyNodes -Value $property.Value -Path $childPath
        }
    }
}

function Test-ReactionJustification {
    param(
        $Value,
        [Parameter(Mandatory = $true)][ValidateSet("StateChange", "ExitPoint")][string]$Role
    )

    if (-not (Test-MeaningfulString -Value $Value)) {
        return $false
    }

    $text = Get-SemanticText -Value $Value
    if ($text -match $falseJustificationPattern -or $text -match $genericJustificationPattern) {
        return $false
    }

    if ($Role -eq "StateChange") {
        return $text -match $stateChangeSignalPattern
    }
    return $text -match $exitPointSignalPattern
}

function Convert-TimeValueToSeconds {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Field
    )

    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [System.Array] -or (Test-JsonObject -Value $Value)) {
        throw "$Field must be a JSON number or timecode string."
    }

    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or
        $Value -is [int64] -or $Value -is [single] -or $Value -is [double] -or
        $Value -is [decimal]) {
        $number = [double]$Value
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
            throw "$Field must be a finite number."
        }
        return $number
    }

    if ($Value -isnot [string]) {
        throw "$Field must be a JSON number or timecode string."
    }
    $text = Get-SemanticText -Value $Value
    if ([string]::IsNullOrWhiteSpace($text) -or
        $text -cnotmatch "^(?<clock>\d{2,}:\d{2}(?::\d{2})?)(?:\.(?<fraction>\d{1,3}))?$") {
        throw "$Field must use MM:SS, MM:SS.mmm, HH:MM:SS, or numeric seconds."
    }

    $parts = @($Matches.clock -split ":" | ForEach-Object { [int]$_ })
    $fraction = 0.0
    if ($Matches.fraction) {
        $fraction = [int]$Matches.fraction.PadRight(3, "0") / 1000.0
    }

    if ($parts.Count -eq 2) {
        if ($parts[1] -ge 60) {
            throw "$Field has seconds outside 00-59."
        }
        return ($parts[0] * 60.0) + $parts[1] + $fraction
    }

    if ($parts[1] -ge 60 -or $parts[2] -ge 60) {
        throw "$Field has minutes or seconds outside 00-59."
    }
    return ($parts[0] * 3600.0) + ($parts[1] * 60.0) + $parts[2] + $fraction
}

function Convert-PlaybackTimeValueToSeconds {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Field
    )

    if ($Value -isnot [string] -or -not (Test-ConcreteSpeedString -Value $Value)) {
        throw "$Field must begin with numeric seconds or a timecode."
    }

    $text = Get-SemanticText -Value $Value
    $match = [regex]::Match(
        $text,
        '^(?<token>\d{2,}:\d{2}(?::\d{2})?(?:\.\d{1,3})?|\d+(?:\.\d+)?)(?:\s*(?:seconds?|secs?|s|\u79d2))?(?=$|[\s,\uff0c;\uff1b:\uff1a-]|[^\x00-\x7F])',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if (-not $match.Success) {
        throw "$Field must begin with numeric seconds or a timecode."
    }

    $token = $match.Groups["token"].Value
    if ($token.Contains(":")) {
        return Convert-TimeValueToSeconds -Value $token -Field $Field
    }

    $number = 0.0
    if (-not [double]::TryParse(
        $token,
        [System.Globalization.NumberStyles]::Float,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$number
    ) -or [double]::IsNaN($number) -or [double]::IsInfinity($number)) {
        throw "$Field must contain finite numeric seconds."
    }
    return $number
}

function Invoke-FightSequenceValidation {
    param(
        [Parameter(Mandatory = $true)]$Data,
        [Parameter(Mandatory = $true)][string[]]$RootProperties,
        $ExpectedTotal,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Shots,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Issues,
        [Parameter(Mandatory = $true)][double]$Epsilon
    )

    $metrics = [pscustomobject]@{
        isFight = $false
        scope = $null
        requiredBeatCount = $null
        effectiveBeatCount = 0
    }

    $fightExecutionLeaves = New-Object System.Collections.ArrayList
    if ($RootProperties -contains "shots") {
        foreach ($leaf in @(Get-StringLeaves -Value $Data.shots -Path "shots")) {
            [void]$fightExecutionLeaves.Add($leaf)
        }
    }
    if ($RootProperties -contains "combatBeats") {
        foreach ($leaf in @(Get-StringLeaves -Value $Data.combatBeats -Path "combatBeats")) {
            [void]$fightExecutionLeaves.Add($leaf)
        }
    }
    foreach ($rootExecutionField in @("title", "description", "purpose", "action", "prompt", "videoPrompt", "choreography")) {
        if ($RootProperties -contains $rootExecutionField) {
            foreach ($leaf in @(Get-StringLeaves -Value $Data.$rootExecutionField -Path $rootExecutionField)) {
                [void]$fightExecutionLeaves.Add($leaf)
            }
        }
    }

    $hasFightStructure = ($RootProperties -contains "combatBeats") -or
        ($RootProperties -contains "fightReferenceSet") -or
        ($RootProperties -contains "powerClash")
    $hasFightLanguage = @($fightExecutionLeaves | Where-Object {
        (Get-SemanticText -Value $_.Value) -match $fightSemanticPattern
    }).Count -gt 0

    if ($RootProperties -notcontains "sequenceType") {
        if ($hasFightStructure -or $hasFightLanguage) {
            Add-Issue -Issues $Issues -Rule "missing-sequence-type" -Shot "" -Message "An explicit complete fight or fight structure must declare sequenceType=fight."
        }
        return $metrics
    }
    if ($Data.sequenceType -isnot [string] -or -not (Test-MeaningfulString -Value $Data.sequenceType)) {
        Add-Issue -Issues $Issues -Rule "invalid-sequence-type" -Shot "" -Message "sequenceType must be a semantically non-empty JSON string."
        return $metrics
    }

    $sequenceType = Get-SemanticText -Value $Data.sequenceType
    if ($sequenceType -cne "fight") {
        if ($hasFightStructure -or $hasFightLanguage) {
            Add-Issue -Issues $Issues -Rule "invalid-sequence-type" -Shot "" -Message "Fight semantics and fight timeline fields require the exact declaration sequenceType=fight."
        }
        return $metrics
    }
    $metrics.isFight = $true

    $fightScope = "complete-sequence"
    $fightScopeValid = $false
    if ($RootProperties -notcontains "fightScope") {
        Add-Issue -Issues $Issues -Rule "missing-fight-scope" -Shot "" -Message "sequenceType=fight requires fightScope=complete-sequence or isolated-beat."
    }
    elseif ($Data.fightScope -isnot [string] -or -not (Test-MeaningfulString -Value $Data.fightScope) -or
        (Get-SemanticText -Value $Data.fightScope) -cnotin $allowedFightScopes) {
        Add-Issue -Issues $Issues -Rule "invalid-fight-scope" -Shot "" -Message "fightScope must be exactly one of: $($allowedFightScopes -join ', ')."
    }
    else {
        $fightScope = Get-SemanticText -Value $Data.fightScope
        $fightScopeValid = $true
    }
    $metrics.scope = $fightScope
    $isCompleteFight = -not $fightScopeValid -or $fightScope -ceq "complete-sequence"

    $sequenceMode = ""
    $sequenceModeValid = $false
    if ($RootProperties -notcontains "sequenceMode") {
        Add-Issue -Issues $Issues -Rule "missing-sequence-mode" -Shot "" -Message "sequenceType=fight requires sequenceMode."
    }
    elseif ($Data.sequenceMode -isnot [string] -or -not (Test-MeaningfulString -Value $Data.sequenceMode) -or
        (Get-SemanticText -Value $Data.sequenceMode) -cnotin $allowedFightSequenceModes) {
        Add-Issue -Issues $Issues -Rule "invalid-sequence-mode" -Shot "" -Message "sequenceMode must be exactly one of: $($allowedFightSequenceModes -join ', ')."
    }
    else {
        $sequenceMode = Get-SemanticText -Value $Data.sequenceMode
        $sequenceModeValid = $true
    }

    $references = @()
    if ($RootProperties -notcontains "fightReferenceSet") {
        if ($isCompleteFight) {
            Add-Issue -Issues $Issues -Rule "missing-fight-reference-set" -Shot "" -Message "A complete fight requires a fightReferenceSet JSON array."
        }
    }
    elseif ($Data.fightReferenceSet -isnot [System.Array]) {
        Add-Issue -Issues $Issues -Rule "invalid-fight-reference-set" -Shot "" -Message "fightReferenceSet must be a JSON array."
    }
    else {
        $references = @($Data.fightReferenceSet)
    }

    $validReferenceLaneCounts = @{
        "current-short-form" = 0
        "long-form-visual" = 0
    }
    $seenFightReferenceIds = @{}
    for ($referenceIndex = 0; $referenceIndex -lt $references.Count; $referenceIndex++) {
        $reference = $references[$referenceIndex]
        $referencePath = "fightReference-$($referenceIndex + 1)"
        if (-not (Test-JsonObject -Value $reference)) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "Every fightReferenceSet entry must be a JSON object."
            continue
        }

        $referenceValid = $true
        foreach ($field in @(
            "sourceId", "sourceLocator", "observedScope", "spatialMechanism", "attackDefenseMechanism",
            "shotScaleMechanism", "cameraMechanism", "editingMechanism", "originEvidence", "authorizationStatus", "reuseBoundary"
        )) {
            if (-not (Test-FightRequiredTextField -Object $reference -Field $field -Issues $Issues -Rule "invalid-fight-reference" -Path $referencePath)) {
                $referenceValid = $false
            }
        }
        if (-not (Test-FightRequiredStringArray -Object $reference -Field "doNotCopy" -Issues $Issues -Rule "invalid-fight-reference" -Path $referencePath)) {
            $referenceValid = $false
        }

        $referenceProperties = @($reference.PSObject.Properties.Name)
        $sourceId = ""
        if ($referenceProperties -contains "sourceId" -and (Test-ConcreteFightString -Value $reference.sourceId)) {
            $sourceId = Get-SemanticText -Value $reference.sourceId
            if ($seenFightReferenceIds.ContainsKey($sourceId)) {
                Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "fightReferenceSet sourceId values must be unique after normalization."
                $referenceValid = $false
            }
            else {
                $seenFightReferenceIds[$sourceId] = $true
            }
        }

        $lane = ""
        if ($referenceProperties -notcontains "lane" -or $reference.lane -isnot [string] -or
            -not (Test-MeaningfulString -Value $reference.lane) -or
            (Get-SemanticText -Value $reference.lane) -cnotin $allowedFightReferenceLanes) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "lane must be exactly current-short-form or long-form-visual."
            $referenceValid = $false
        }
        else {
            $lane = Get-SemanticText -Value $reference.lane
        }

        $medium = ""
        if ($referenceProperties -notcontains "medium" -or $reference.medium -isnot [string] -or
            -not (Test-MeaningfulString -Value $reference.medium) -or
            (Get-SemanticText -Value $reference.medium) -cnotin $allowedFightReferenceMedia) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "medium must be exactly short-video, anime, or film."
            $referenceValid = $false
        }
        else {
            $medium = Get-SemanticText -Value $reference.medium
        }
        if (($lane -ceq "current-short-form" -and $medium -cne "short-video") -or
            ($lane -ceq "long-form-visual" -and $medium -cnotin @("anime", "film"))) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "Reference medium must match its short-form or long-form visual lane."
            $referenceValid = $false
        }

        $creationMode = ""
        if ($referenceProperties -notcontains "observedRangeCreationMode" -or
            $reference.observedRangeCreationMode -isnot [string] -or
            -not (Test-MeaningfulString -Value $reference.observedRangeCreationMode) -or
            (Get-SemanticText -Value $reference.observedRangeCreationMode) -cnotin $allowedObservedRangeCreationModes) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference-origin" -Shot $referencePath -Message "observedRangeCreationMode must be exactly human-directed, ai-generated, or origin-unverified."
            $referenceValid = $false
        }
        else {
            $creationMode = Get-SemanticText -Value $reference.observedRangeCreationMode
            if ($creationMode -ceq "ai-generated") {
                Add-Issue -Issues $Issues -Rule "ai-generated-fight-reference-forbidden" -Shot $referencePath -Message "AI-generated fight footage belongs in generationBenchmarkSet and cannot support creative fight direction."
                $referenceValid = $false
            }
            elseif ($creationMode -ceq "origin-unverified") {
                Add-Issue -Issues $Issues -Rule "unverified-fight-reference-origin" -Shot $referencePath -Message "Unknown creation origin cannot support fight choreography, camera, action, or performance reference."
                $referenceValid = $false
            }
        }

        if ($referenceProperties -notcontains "evidenceLevel" -or $reference.evidenceLevel -isnot [string] -or
            (Get-SemanticText -Value $reference.evidenceLevel) -cne "A") {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "Fight visual reference evidenceLevel must be exactly A."
            $referenceValid = $false
        }
        if ($referenceProperties -notcontains "visual" -or $reference.visual -isnot [string] -or
            (Get-SemanticText -Value $reference.visual) -cnotin @("yes", "partial")) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "Fight visual reference visual must be exactly yes or partial."
            $referenceValid = $false
        }
        if ($referenceProperties -notcontains "referenceUseMode" -or $reference.referenceUseMode -isnot [string] -or
            (Get-SemanticText -Value $reference.referenceUseMode) -cnotin $allowedFightReferenceUseModes) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "referenceUseMode must be an allowed rights-aware use mode."
            $referenceValid = $false
        }

        if ($lane -ceq "current-short-form") {
            foreach ($field in @("publishedAt", "capturedAt", "currentRelevanceEvidence")) {
                if (-not (Test-FightRequiredTextField -Object $reference -Field $field -Issues $Issues -Rule "invalid-fight-reference" -Path $referencePath)) {
                    $referenceValid = $false
                }
            }
            if ($referenceProperties -notcontains "selectionBasis" -or $reference.selectionBasis -isnot [string] -or
                (Get-SemanticText -Value $reference.selectionBasis) -cnotin @("viral", "quality")) {
                Add-Issue -Issues $Issues -Rule "invalid-fight-reference" -Shot $referencePath -Message "current-short-form selectionBasis must be exactly viral or quality."
                $referenceValid = $false
            }
            elseif ((Get-SemanticText -Value $reference.selectionBasis) -ceq "viral") {
                if (-not (Test-FightRequiredTextField -Object $reference -Field "rankOrHeat" -Issues $Issues -Rule "invalid-fight-reference" -Path $referencePath)) {
                    $referenceValid = $false
                }
            }
            elseif (-not (Test-FightRequiredTextField -Object $reference -Field "qualityRationale" -Issues $Issues -Rule "invalid-fight-reference" -Path $referencePath)) {
                $referenceValid = $false
            }
        }

        if ($referenceValid -and $validReferenceLaneCounts.ContainsKey($lane)) {
            $validReferenceLaneCounts[$lane]++
        }
    }

    if ($isCompleteFight) {
        $researchStatus = ""
        $researchStatusValid = $false
        if ($RootProperties -notcontains "researchStatus" -or $Data.researchStatus -isnot [string] -or
            (Get-SemanticText -Value $Data.researchStatus) -cnotin @("complete", "blocked-provisional")) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-research-status" -Shot "" -Message "A complete fight requires researchStatus=complete or blocked-provisional."
        }
        else {
            $researchStatus = Get-SemanticText -Value $Data.researchStatus
            $researchStatusValid = $true
        }

        $finalizationHoldValid = $RootProperties -contains "finalizationHold" -and $Data.finalizationHold -is [bool]
        $releaseHoldValid = $RootProperties -contains "releaseHold" -and $Data.releaseHold -is [bool]
        if (-not $finalizationHoldValid) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-finalization-hold" -Shot "" -Message "A complete fight requires a native JSON boolean finalizationHold."
        }
        if (-not $releaseHoldValid) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-release-hold" -Shot "" -Message "A complete fight requires a native JSON boolean releaseHold."
        }

        if ($researchStatusValid -and $researchStatus -ceq "complete") {
            if ($validReferenceLaneCounts["current-short-form"] -lt 1 -or $validReferenceLaneCounts["long-form-visual"] -lt 1) {
                Add-Issue -Issues $Issues -Rule "missing-fight-reference-track" -Shot "" -Message "Complete fight research requires one valid current-short-form A-level visual and one valid long-form anime/film A-level visual."
            }
            if ($finalizationHoldValid -and $Data.finalizationHold) {
                Add-Issue -Issues $Issues -Rule "complete-fight-still-held" -Shot "" -Message "Complete fight research must use finalizationHold=false."
            }
        }
        elseif ($researchStatusValid -and $researchStatus -ceq "blocked-provisional") {
            if ($finalizationHoldValid -and -not $Data.finalizationHold) {
                Add-Issue -Issues $Issues -Rule "provisional-fight-without-finalization-hold" -Shot "" -Message "Blocked fight research requires finalizationHold=true."
            }
            if ($releaseHoldValid -and -not $Data.releaseHold) {
                Add-Issue -Issues $Issues -Rule "provisional-fight-without-release-hold" -Shot "" -Message "Blocked fight research requires releaseHold=true."
            }
            [void](Test-FightRequiredTextField -Object $Data -Field "researchBlocker" -Issues $Issues -Rule "missing-fight-research-blocker" -Path "")
            [void](Test-FightRequiredStringArray -Object $Data -Field "blockerEvidence" -Issues $Issues -Rule "missing-fight-blocker-evidence" -Path "")
            if ($validReferenceLaneCounts["current-short-form"] -gt 0 -and $validReferenceLaneCounts["long-form-visual"] -gt 0) {
                Add-Issue -Issues $Issues -Rule "unnecessary-fight-provisional-status" -Shot "" -Message "Both required fight visual tracks are valid; use researchStatus=complete."
            }
        }
    }

    $combatBeats = @()
    if ($RootProperties -notcontains "combatBeats") {
        Add-Issue -Issues $Issues -Rule "missing-combat-beats" -Shot "" -Message "sequenceType=fight requires a combatBeats JSON array."
    }
    elseif ($Data.combatBeats -isnot [System.Array]) {
        Add-Issue -Issues $Issues -Rule "invalid-combat-beats-type" -Shot "" -Message "combatBeats must be a JSON array."
    }
    else {
        $combatBeats = @($Data.combatBeats)
        if ($combatBeats.Count -eq 0) {
            Add-Issue -Issues $Issues -Rule "missing-combat-beats" -Shot "" -Message "sequenceType=fight requires at least one combat beat."
        }
    }

    $effectiveBeats = New-Object System.Collections.ArrayList
    $seenCombatBeatIds = @{}
    $allValidCombatBeatIds = @{}
    $seenFightBeatResults = @{}
    $dynamicCameraTransitions = New-Object System.Collections.ArrayList
    $fightCameraPlans = New-Object System.Collections.ArrayList
    $fightCameraPurposes = New-Object System.Collections.ArrayList
    for ($beatIndex = 0; $beatIndex -lt $combatBeats.Count; $beatIndex++) {
        $beat = $combatBeats[$beatIndex]
        $beatPath = "combatBeat-$($beatIndex + 1)"
        if (-not (Test-JsonObject -Value $beat)) {
            Add-Issue -Issues $Issues -Rule "invalid-combat-beat" -Shot $beatPath -Message "Every combatBeats entry must be a JSON object."
            continue
        }
        $beatProperties = @($beat.PSObject.Properties.Name)
        $beatValid = $true
        $beatId = $beatPath
        if ($beatProperties -notcontains "id" -or -not (Test-ConcreteFightString -Value $beat.id)) {
            Add-Issue -Issues $Issues -Rule "invalid-combat-beat-id" -Shot $beatPath -Message "Every combat beat must have a concrete string id."
            $beatValid = $false
        }
        else {
            $beatId = Get-SemanticText -Value $beat.id
            $beatPath = $beatId
            if ($seenCombatBeatIds.ContainsKey($beatId)) {
                Add-Issue -Issues $Issues -Rule "duplicate-combat-beat-id" -Shot $beatPath -Message "Combat beat ids must be unique after normalization."
                $beatValid = $false
            }
            else {
                $seenCombatBeatIds[$beatId] = $true
                $allValidCombatBeatIds[$beatId] = $true
            }
        }

        $beatStart = $null
        $beatEnd = $null
        $beatTimeValid = $true
        foreach ($timeField in @("start", "end")) {
            if ($beatProperties -notcontains $timeField) {
                Add-Issue -Issues $Issues -Rule "invalid-combat-beat-time" -Shot $beatPath -Message "Combat beat $timeField is required."
                $beatTimeValid = $false
                continue
            }
            try {
                $converted = Convert-TimeValueToSeconds -Value $beat.$timeField -Field "$beatPath.$timeField"
                if ($timeField -ceq "start") { $beatStart = $converted } else { $beatEnd = $converted }
            }
            catch {
                Add-Issue -Issues $Issues -Rule "invalid-combat-beat-time" -Shot $beatPath -Message $_.Exception.Message
                $beatTimeValid = $false
            }
        }
        if ($beatTimeValid) {
            if ($beatStart -lt -$Epsilon -or $beatEnd -le ($beatStart + $Epsilon) -or
                ($null -ne $ExpectedTotal -and $beatEnd -gt ($ExpectedTotal + $Epsilon))) {
                Add-Issue -Issues $Issues -Rule "invalid-combat-beat-time" -Shot $beatPath -Message "Combat beat time must be positive, ordered, and contained by totalDuration."
                $beatTimeValid = $false
            }
        }
        if (-not $beatTimeValid) { $beatValid = $false }

        $phase = ""
        if ($beatProperties -notcontains "phase" -or $beat.phase -isnot [string] -or
            -not (Test-MeaningfulString -Value $beat.phase) -or
            (Get-SemanticText -Value $beat.phase) -cnotin $allowedFightBeatPhases) {
            Add-Issue -Issues $Issues -Rule "invalid-combat-beat-phase" -Shot $beatPath -Message "phase must be exactly attack, response, or result."
            $beatValid = $false
        }
        else {
            $phase = Get-SemanticText -Value $beat.phase
        }

        foreach ($field in @("objective", "opponentResponse", "cameraPlan", "cameraPurpose", "phaseResult", "dominanceBefore", "dominanceAfter")) {
            if (-not (Test-FightRequiredTextField -Object $beat -Field $field -Issues $Issues -Rule "invalid-combat-beat" -Path $beatPath)) {
                $beatValid = $false
            }
        }

        if ($beatProperties -contains "phaseResult" -and (Test-ConcreteFightString -Value $beat.phaseResult)) {
            $phaseResultText = Get-SemanticText -Value $beat.phaseResult
            if ($phaseResultText -match $fightNoProgressPattern -or $phaseResultText -notmatch $fightResultProgressPattern) {
                Add-Issue -Issues $Issues -Rule "invalid-combat-beat-result" -Shot $beatPath -Message "phaseResult must name a verifiable combat-state consequence; unchanged action, repeated effects, and generic continuation do not count."
                $beatValid = $false
            }
            else {
                $normalizedPhaseResult = [regex]::Replace(
                    $phaseResultText.ToLowerInvariant(),
                    '\b(?:beat|shot)?\s*\d+\b',
                    ''
                ).Trim()
                if ($seenFightBeatResults.ContainsKey($normalizedPhaseResult)) {
                    Add-Issue -Issues $Issues -Rule "invalid-combat-beat-result" -Shot $beatPath -Message "Effective combat beats may not repeat the same phaseResult under different ids or timestamps."
                    $beatValid = $false
                }
                else {
                    $seenFightBeatResults[$normalizedPhaseResult] = $true
                }
            }
        }

        if ($beatProperties -contains "cameraPlan" -and (Test-ConcreteFightString -Value $beat.cameraPlan)) {
            $cameraPlanText = Get-SemanticText -Value $beat.cameraPlan
            if ($cameraPlanText -match $unqualifiedFightCameraPattern) {
                Add-Issue -Issues $Issues -Rule "invalid-fight-camera-plan" -Shot $beatPath -Message "Camera planning may not use decorative orbit, aimless drift, or passive unchanged observation as fight progression."
                $beatValid = $false
            }
            $normalizedCameraPlan = $cameraPlanText.ToLowerInvariant()
            if (-not $fightCameraPlans.Contains($normalizedCameraPlan)) {
                [void]$fightCameraPlans.Add($normalizedCameraPlan)
            }
        }
        if ($beatProperties -contains "cameraPurpose" -and (Test-ConcreteFightString -Value $beat.cameraPurpose)) {
            $normalizedCameraPurpose = [regex]::Replace(
                (Get-SemanticText -Value $beat.cameraPurpose).ToLowerInvariant(),
                '\b(?:beat|shot)?\s*\d+\b',
                ''
            ).Trim()
            if (-not $fightCameraPurposes.Contains($normalizedCameraPurpose)) {
                [void]$fightCameraPurposes.Add($normalizedCameraPurpose)
            }
        }

        $stateChanges = @()
        $stateChangesValid = $true
        if ($beatProperties -notcontains "stateChanges" -or $beat.stateChanges -isnot [System.Array]) {
            Add-Issue -Issues $Issues -Rule "invalid-combat-state-changes" -Shot $beatPath -Message "stateChanges must be a non-empty JSON array of canonical real combat changes."
            $stateChangesValid = $false
        }
        else {
            $stateChanges = @($beat.stateChanges)
            $normalizedStateChanges = @($stateChanges | ForEach-Object {
                if ($_ -is [string]) { Get-SemanticText -Value $_ } else { $null }
            })
            if ($stateChanges.Count -eq 0 -or
                @($normalizedStateChanges | Where-Object { $null -eq $_ -or $_ -cnotin $allowedFightStateChanges }).Count -gt 0 -or
                @($normalizedStateChanges | Select-Object -Unique).Count -ne $normalizedStateChanges.Count) {
                Add-Issue -Issues $Issues -Rule "invalid-combat-state-changes" -Shot $beatPath -Message "stateChanges entries must be unique exact values from: $($allowedFightStateChanges -join ', ')."
                $stateChangesValid = $false
            }
            else {
                $stateChanges = $normalizedStateChanges
            }
        }
        if (-not $stateChangesValid) { $beatValid = $false }

        if ($sequenceModeValid -and $sequenceMode -ceq "dynamic-long-take") {
            $dynamicBeatValid = $true
            foreach ($field in @("trigger", "cameraTransition", "visualAnchor", "settlePoint")) {
                if (-not (Test-FightRequiredTextField -Object $beat -Field $field -Issues $Issues -Rule "invalid-dynamic-long-take-beat" -Path $beatPath)) {
                    $dynamicBeatValid = $false
                }
            }
            if ($dynamicBeatValid) {
                $triggerText = Get-SemanticText -Value $beat.trigger
                $transitionText = Get-SemanticText -Value $beat.cameraTransition
                if ($triggerText -notmatch $fightCameraTriggerSignalPattern -or
                    $transitionText -notmatch $fightCameraTransitionSignalPattern -or
                    $transitionText -match $unqualifiedFightCameraPattern) {
                    Add-Issue -Issues $Issues -Rule "invalid-dynamic-long-take-beat" -Shot $beatPath -Message "A dynamic-long-take beat needs an action/information trigger and a concrete non-decorative camera state transition."
                    $beatValid = $false
                }
                else {
                    $transition = $transitionText.ToLowerInvariant()
                    if (-not $dynamicCameraTransitions.Contains($transition)) {
                        [void]$dynamicCameraTransitions.Add($transition)
                    }
                }
            }
        }

        if ($beatValid) {
            [void]$effectiveBeats.Add([pscustomobject]@{
                id = $beatId
                start = [double]$beatStart
                end = [double]$beatEnd
                phase = $phase
                stateChanges = @($stateChanges)
                dominanceBefore = Get-SemanticText -Value $beat.dominanceBefore
                dominanceAfter = Get-SemanticText -Value $beat.dominanceAfter
            })
        }
    }
    $metrics.effectiveBeatCount = $effectiveBeats.Count

    $requiredBeatCount = 3
    if ($null -ne $ExpectedTotal -and $ExpectedTotal -gt $Epsilon) {
        $requiredBeatCount = [int][Math]::Max(3, [Math]::Ceiling($ExpectedTotal / 5.0))
    }
    $metrics.requiredBeatCount = $requiredBeatCount

    $orderedEffectiveBeats = @($effectiveBeats | Sort-Object -Property end, start)
    for ($orderedIndex = 1; $orderedIndex -lt $orderedEffectiveBeats.Count; $orderedIndex++) {
        $previousBeat = $orderedEffectiveBeats[$orderedIndex - 1]
        $currentBeat = $orderedEffectiveBeats[$orderedIndex]
        if ($currentBeat.start -lt ($previousBeat.start - $Epsilon) -or $currentBeat.end -le ($previousBeat.end + $Epsilon)) {
            Add-Issue -Issues $Issues -Rule "combat-beat-order" -Shot $currentBeat.id -Message "Combat beats must produce state changes in strictly increasing timeline order."
        }
    }

    if ($isCompleteFight) {
        if ($effectiveBeats.Count -lt $requiredBeatCount) {
            Add-Issue -Issues $Issues -Rule "insufficient-combat-beats" -Shot "" -Message "A $ExpectedTotal-second complete fight requires at least $requiredBeatCount effective combat beats; found $($effectiveBeats.Count)."
        }

        if ($orderedEffectiveBeats.Count -gt 0) {
            if ($orderedEffectiveBeats[0].end -gt (6.0 + $Epsilon)) {
                Add-Issue -Issues $Issues -Rule "combat-beat-gap" -Shot $orderedEffectiveBeats[0].id -Message "The first real combat state change must land within 6 seconds."
            }
            for ($gapIndex = 1; $gapIndex -lt $orderedEffectiveBeats.Count; $gapIndex++) {
                $changeGap = $orderedEffectiveBeats[$gapIndex].end - $orderedEffectiveBeats[$gapIndex - 1].end
                if ($changeGap -gt (6.0 + $Epsilon)) {
                    Add-Issue -Issues $Issues -Rule "combat-beat-gap" -Shot $orderedEffectiveBeats[$gapIndex].id -Message "Adjacent real combat state changes may not be more than 6 seconds apart."
                }
            }
            if ($null -ne $ExpectedTotal -and ($ExpectedTotal - $orderedEffectiveBeats[-1].end) -gt (6.0 + $Epsilon)) {
                Add-Issue -Issues $Issues -Rule "combat-beat-gap" -Shot $orderedEffectiveBeats[-1].id -Message "The final combat state change may not leave more than 6 seconds of inert tail."
            }
        }

        $coveredPhases = @($orderedEffectiveBeats | ForEach-Object { $_.phase } | Select-Object -Unique)
        if (@($allowedFightBeatPhases | Where-Object { $_ -cnotin $coveredPhases }).Count -gt 0) {
            Add-Issue -Issues $Issues -Rule "missing-combat-phase-coverage" -Shot "" -Message "A complete fight must contain effective attack, response, and result phases."
        }

        $dominanceShiftCount = 0
        for ($dominanceIndex = 0; $dominanceIndex -lt $orderedEffectiveBeats.Count; $dominanceIndex++) {
            $beatSummary = $orderedEffectiveBeats[$dominanceIndex]
            if ($dominanceIndex -gt 0 -and
                $beatSummary.dominanceBefore -ine $orderedEffectiveBeats[$dominanceIndex - 1].dominanceAfter) {
                Add-Issue -Issues $Issues -Rule "dominance-continuity-break" -Shot $beatSummary.id -Message "dominanceBefore must continue the preceding effective beat's dominanceAfter."
            }
            if ($beatSummary.dominanceBefore -ine $beatSummary.dominanceAfter -and
                $beatSummary.stateChanges -ccontains "dominance") {
                $dominanceShiftCount++
            }
        }
        $requiredDominanceShifts = [int][Math]::Max(1, [Math]::Floor($requiredBeatCount / 3.0))
        if ($dominanceShiftCount -lt $requiredDominanceShifts) {
            Add-Issue -Issues $Issues -Rule "insufficient-dominance-shifts" -Shot "" -Message "This fight requires at least $requiredDominanceShifts major dominance shifts; found $dominanceShiftCount."
        }
    }
    elseif ($fightScopeValid -and $fightScope -ceq "isolated-beat" -and
        ($combatBeats.Count -gt 1 -or $RootProperties -contains "powerClash" -or
            ($null -ne $ExpectedTotal -and $ExpectedTotal -gt (6.0 + $Epsilon)))) {
        Add-Issue -Issues $Issues -Rule "invalid-isolated-fight-scope" -Shot "" -Message "isolated-beat is only for one short hit, move insert, or result insert of at most 6 seconds, not a multi-beat exchange, long scene, or power clash."
    }

    $validFightShotRoles = New-Object System.Collections.ArrayList
    $validFightShotCount = 0
    for ($fightShotIndex = 0; $fightShotIndex -lt $Shots.Count; $fightShotIndex++) {
        $fightShot = $Shots[$fightShotIndex]
        $fightShotPath = "index-$($fightShotIndex + 1)"
        if (-not (Test-JsonObject -Value $fightShot)) { continue }
        $validFightShotCount++
        $fightShotProperties = @($fightShot.PSObject.Properties.Name)
        if ($fightShotProperties -contains "id" -and (Test-MeaningfulString -Value $fightShot.id)) {
            $fightShotPath = Get-SemanticText -Value $fightShot.id
        }
        if ($fightShotProperties -notcontains "fightShotRole") {
            Add-Issue -Issues $Issues -Rule "missing-fight-shot-role" -Shot $fightShotPath -Message "Every fight shot must declare fightShotRole."
        }
        elseif ($fightShot.fightShotRole -isnot [string] -or -not (Test-MeaningfulString -Value $fightShot.fightShotRole) -or
            (Get-SemanticText -Value $fightShot.fightShotRole) -cnotin $allowedFightShotRoles) {
            Add-Issue -Issues $Issues -Rule "invalid-fight-shot-role" -Shot $fightShotPath -Message "fightShotRole must be an exact canonical camera responsibility."
        }
        else {
            $role = Get-SemanticText -Value $fightShot.fightShotRole
            if (-not $validFightShotRoles.Contains($role)) {
                [void]$validFightShotRoles.Add($role)
            }
        }

        if ($fightShotProperties -notcontains "combatBeatIds") {
            Add-Issue -Issues $Issues -Rule "missing-fight-shot-beat-link" -Shot $fightShotPath -Message "Every fight shot must link to at least one declared combat beat through combatBeatIds."
        }
        else {
            $linksValid = $fightShot.combatBeatIds -is [System.Array]
            if ($linksValid) {
                $links = @($fightShot.combatBeatIds)
                $normalizedLinks = @($links | ForEach-Object {
                    if ($_ -is [string] -and (Test-ConcreteFightString -Value $_)) { Get-SemanticText -Value $_ } else { $null }
                })
                $linksValid = $links.Count -gt 0 -and
                    @($normalizedLinks | Where-Object { $null -eq $_ -or -not $allValidCombatBeatIds.ContainsKey($_) }).Count -eq 0 -and
                    @($normalizedLinks | Select-Object -Unique).Count -eq $normalizedLinks.Count
            }
            if (-not $linksValid) {
                Add-Issue -Issues $Issues -Rule "invalid-fight-shot-beat-link" -Shot $fightShotPath -Message "combatBeatIds must be a non-empty unique array of declared combat beat ids."
            }
        }
    }

    if ($isCompleteFight -and $sequenceModeValid -and $sequenceMode -ceq "multi-shot") {
        $minimumShotCount = [int][Math]::Max(2, [Math]::Ceiling($requiredBeatCount / 2.0))
        if ($validFightShotCount -lt $minimumShotCount) {
            Add-Issue -Issues $Issues -Rule "insufficient-fight-shots" -Shot "" -Message "multi-shot fight mode requires at least $minimumShotCount shots for $requiredBeatCount effective beats."
        }
        if ($validFightShotRoles.Count -lt 2) {
            Add-Issue -Issues $Issues -Rule "insufficient-camera-state-changes" -Shot "" -Message "multi-shot fight mode requires at least two distinct camera responsibilities; repeated angles do not create progress."
        }
        $hasSpatialCameraRole = $validFightShotRoles -ccontains "space-establish"
        $hasParticipatingCameraRole = @($validFightShotRoles | Where-Object {
            $_ -cin @("pursuit-evasion", "contact-clarity", "impact-reception")
        }).Count -gt 0
        $hasConsequenceCameraRole = @($validFightShotRoles | Where-Object {
            $_ -cin @("contact-clarity", "impact-reception", "reversal-reveal", "result-reframe")
        }).Count -gt 0
        if (-not $hasSpatialCameraRole -or -not $hasParticipatingCameraRole -or -not $hasConsequenceCameraRole) {
            Add-Issue -Issues $Issues -Rule "missing-fight-camera-coverage" -Shot "" -Message "multi-shot fight coverage must orient space, participate in pursuit/contact/impact, and clarify a contact, reversal, or result."
        }
        if ($fightCameraPlans.Count -lt 2 -or $fightCameraPurposes.Count -lt 2) {
            Add-Issue -Issues $Issues -Rule "insufficient-camera-state-changes" -Shot "" -Message "multi-shot fight mode requires at least two distinct concrete camera plans and purposes; relabeling repeated coverage does not create progress."
        }
    }
    elseif ($isCompleteFight -and $sequenceModeValid -and $sequenceMode -ceq "dynamic-long-take") {
        if ($validFightShotCount -ne 1) {
            Add-Issue -Issues $Issues -Rule "invalid-dynamic-long-take-shot-count" -Shot "" -Message "dynamic-long-take is the one-shot exception and must contain exactly one shot."
        }
        if ($dynamicCameraTransitions.Count -lt 2) {
            Add-Issue -Issues $Issues -Rule "insufficient-camera-state-changes" -Shot "" -Message "A dynamic long take requires at least two distinct action-triggered camera transitions."
        }
    }

    $hasSemanticClash = @($fightExecutionLeaves | Where-Object {
        (Get-SemanticText -Value $_.Value) -match $powerClashPattern
    }).Count -gt 0
    if ($RootProperties -contains "powerClash" -or $hasSemanticClash) {
        $clashValid = $true
        if ($RootProperties -notcontains "powerClash" -or -not (Test-JsonObject -Value $Data.powerClash)) {
            Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot "" -Message "A declared or semantically explicit power clash requires a structured evolving powerClash contract."
            $clashValid = $false
        }
        else {
            $powerClash = $Data.powerClash
            $powerClashProperties = @($powerClash.PSObject.Properties.Name)
            foreach ($field in @("initialBalance", "tacticalInterventionOrAbilityChange", "breakCondition", "environmentalForceResponse", "finalOutcome")) {
                if (-not (Test-FightRequiredTextField -Object $powerClash -Field $field -Issues $Issues -Rule "unevolved-power-clash" -Path "powerClash")) {
                    $clashValid = $false
                }
            }

            if ($powerClashProperties -notcontains "pressureShifts" -or $powerClash.pressureShifts -isnot [System.Array] -or
                @($powerClash.pressureShifts).Count -lt 2) {
                Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot "powerClash" -Message "powerClash.pressureShifts must contain at least two pressure transfers."
                $clashValid = $false
            }
            else {
                $seenPressureSides = @{}
                $seenPressureCauses = @{}
                $seenPressureResults = @{}
                $previousPressureAt = $null
                $pressureShifts = @($powerClash.pressureShifts)
                for ($pressureIndex = 0; $pressureIndex -lt $pressureShifts.Count; $pressureIndex++) {
                    $pressure = $pressureShifts[$pressureIndex]
                    $pressurePath = "powerClash.pressureShift-$($pressureIndex + 1)"
                    if (-not (Test-JsonObject -Value $pressure)) {
                        Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot $pressurePath -Message "Every pressure shift must be a JSON object."
                        $clashValid = $false
                        continue
                    }
                    $pressureProperties = @($pressure.PSObject.Properties.Name)
                    $pressureAt = $null
                    if ($pressureProperties -notcontains "at") {
                        Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot $pressurePath -Message "Every pressure shift requires at."
                        $clashValid = $false
                    }
                    else {
                        try {
                            $pressureAt = Convert-TimeValueToSeconds -Value $pressure.at -Field "$pressurePath.at"
                            if ($pressureAt -lt -$Epsilon -or
                                ($null -ne $ExpectedTotal -and $pressureAt -gt ($ExpectedTotal + $Epsilon)) -or
                                ($null -ne $previousPressureAt -and $pressureAt -le ($previousPressureAt + $Epsilon))) {
                                throw "$pressurePath.at must be inside totalDuration and strictly increasing."
                            }
                            $previousPressureAt = $pressureAt
                        }
                        catch {
                            Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot $pressurePath -Message $_.Exception.Message
                            $clashValid = $false
                        }
                    }
                    foreach ($fieldAndSeen in @(
                        [pscustomobject]@{ field = "advantagedSide"; seen = $seenPressureSides },
                        [pscustomobject]@{ field = "cause"; seen = $seenPressureCauses },
                        [pscustomobject]@{ field = "visibleResult"; seen = $seenPressureResults }
                    )) {
                        $field = $fieldAndSeen.field
                        if (-not (Test-FightRequiredTextField -Object $pressure -Field $field -Issues $Issues -Rule "unevolved-power-clash" -Path $pressurePath)) {
                            $clashValid = $false
                            continue
                        }
                        $normalizedValue = (Get-SemanticText -Value $pressure.$field).ToLowerInvariant()
                        if ($fieldAndSeen.seen.ContainsKey($normalizedValue)) {
                            Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot $pressurePath -Message "Pressure-shift $field values must visibly change rather than repeat."
                            $clashValid = $false
                        }
                        else {
                            $fieldAndSeen.seen[$normalizedValue] = $true
                        }
                    }
                }
            }

            if ($powerClashProperties -notcontains "clashBeatIds" -or $powerClash.clashBeatIds -isnot [System.Array]) {
                Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot "powerClash" -Message "powerClash.clashBeatIds must identify the bounded clash phase."
                $clashValid = $false
            }
            else {
                $clashBeatIds = @($powerClash.clashBeatIds)
                $normalizedClashBeatIds = @($clashBeatIds | ForEach-Object {
                    if ($_ -is [string] -and (Test-ConcreteFightString -Value $_)) { Get-SemanticText -Value $_ } else { $null }
                })
                if ($clashBeatIds.Count -eq 0 -or
                    @($normalizedClashBeatIds | Where-Object { $null -eq $_ -or -not $allValidCombatBeatIds.ContainsKey($_) }).Count -gt 0 -or
                    @($normalizedClashBeatIds | Select-Object -Unique).Count -ne $normalizedClashBeatIds.Count -or
                    ($combatBeats.Count -gt 0 -and $normalizedClashBeatIds.Count -ge $combatBeats.Count)) {
                    Add-Issue -Issues $Issues -Rule "unevolved-power-clash" -Shot "powerClash" -Message "The clash must reference at least one declared beat but may not occupy every combat beat."
                    $clashValid = $false
                }
            }
        }
        if (-not $clashValid -and $fightScopeValid -and $fightScope -ceq "isolated-beat") {
            Add-Issue -Issues $Issues -Rule "invalid-isolated-fight-scope" -Shot "" -Message "A power clash cannot be delivered as an isolated-beat exception."
        }
    }

    return $metrics
}

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Missing storyboard timeline file: $InputPath"
}

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$data = Get-Content -LiteralPath $resolvedInput -Raw -Encoding UTF8 | ConvertFrom-Json
$issues = New-Object System.Collections.ArrayList

if (-not (Test-JsonObject -Value $data)) {
    Add-Issue -Issues $issues -Rule "invalid-root-type" -Shot "" -Message "The storyboard timeline root must be a JSON object."
    $data = [pscustomobject]@{}
}
$rootProperties = @($data.PSObject.Properties.Name)

if ($rootProperties -contains "playback_speed" -and
    (Test-ContainsPlaybackRemapCue -Value $data.playback_speed)) {
    Add-Issue -Issues $issues -Rule "orphan-playback-speed" -Shot "" -Message "Top-level playback_speed remapping is outside the canonical per-shot speed_profile.playback_speed branch."
    Add-Issue -Issues $issues -Rule "missing-speed-profile" -Shot "" -Message "Top-level slow/fast playback intent requires a canonical per-shot speed_profile."
}

$expectedTotal = $null
if ($rootProperties -notcontains "totalDuration") {
    Add-Issue -Issues $issues -Rule "invalid-total-duration" -Shot "" -Message "Missing required totalDuration."
}
else {
    try {
        $expectedTotal = Convert-TimeValueToSeconds -Value $data.totalDuration -Field "totalDuration"
        if ($expectedTotal -le $epsilon) {
            Add-Issue -Issues $issues -Rule "invalid-total-duration" -Shot "" -Message "totalDuration must be greater than zero."
        }
    }
    catch {
        Add-Issue -Issues $issues -Rule "invalid-total-duration" -Shot "" -Message $_.Exception.Message
        $expectedTotal = $null
    }
}

$shots = @()
if ($rootProperties -notcontains "shots") {
    Add-Issue -Issues $issues -Rule "missing-shots" -Shot "" -Message "The storyboard timeline must contain a shots array."
}
elseif ($data.shots -isnot [System.Array]) {
    Add-Issue -Issues $issues -Rule "invalid-shots-type" -Shot "" -Message "shots must be a JSON array, even when it contains one shot."
}
else {
    $shots = @($data.shots)
    if ($shots.Count -eq 0) {
        Add-Issue -Issues $issues -Rule "missing-shots" -Shot "" -Message "The storyboard timeline must contain at least one shot."
    }
}

$seenIds = @{}
$seenKeyframeIds = @{}
$previousEnd = 0.0
$lastEnd = 0.0
$validTemporalShotCount = 0

for ($index = 0; $index -lt $shots.Count; $index++) {
    $shot = $shots[$index]
    $fallbackShotId = "index-$($index + 1)"
    if (-not (Test-JsonObject -Value $shot)) {
        Add-Issue -Issues $issues -Rule "invalid-shot-type" -Shot $fallbackShotId -Message "Every shots entry must be a JSON object."
        continue
    }

    $shotProperties = @($shot.PSObject.Properties.Name)
    $shotId = $fallbackShotId
    if ($shotProperties -notcontains "id") {
        Add-Issue -Issues $issues -Rule "missing-shot-id" -Shot $shotId -Message "Every shot must have a stable string id."
    }
    elseif ($shot.id -isnot [string]) {
        Add-Issue -Issues $issues -Rule "invalid-shot-id-type" -Shot $shotId -Message "Shot id must be a JSON string."
    }
    elseif (-not (Test-MeaningfulString -Value $shot.id)) {
        Add-Issue -Issues $issues -Rule "missing-shot-id" -Shot $shotId -Message "Shot id must be semantically non-empty."
    }
    else {
        $shotId = Get-SemanticText -Value $shot.id
        if ($seenIds.ContainsKey($shotId) -or $seenKeyframeIds.ContainsKey($shotId)) {
            Add-Issue -Issues $issues -Rule "duplicate-shot-id" -Shot $shotId -Message "Shot ids must be unique after normalization."
        }
        else {
            $seenIds[$shotId] = $true
        }
    }

    $shotLeaves = @(Get-StringLeaves -Value $shot -Path "shot")
    $shotPropertyNodes = @(Get-JsonPropertyNodes -Value $shot -Path "shot")
    $fillerLeaves = @($shotLeaves | Where-Object { (Get-SemanticText -Value $_.Value) -match $fillerPattern })
    $fillerPropertyNodes = @($shotPropertyNodes | Where-Object {
        (Get-SemanticText -Value $_.Name) -match $forbiddenPropertyNamePattern
    })
    if ($fillerLeaves.Count -gt 0 -or $fillerPropertyNodes.Count -gt 0) {
        $paths = @(
            @($fillerLeaves | ForEach-Object { $_.Path })
            @($fillerPropertyNodes | ForEach-Object { $_.Path })
        ) | Select-Object -Unique
        Add-Issue -Issues $issues -Rule "forbidden-padding-anywhere" -Shot $shotId -Message "Filler or padding language is forbidden in all shot values and recursive property names. Paths: $($paths -join ', ')"
    }

    $motionLeaves = @(
        foreach ($propertyNode in $shotPropertyNodes) {
            if ((Get-SemanticText -Value $propertyNode.Name) -notmatch $motionSemanticPropertyPattern) {
                continue
            }
            Get-StringLeaves -Value $propertyNode.Value -Path $propertyNode.Path
        }
    )
    $strongSpeedLeaves = @($motionLeaves | Where-Object {
        (Get-SemanticText -Value $_.Value) -match $strongSpeedCuePattern
    })
    $isolatedSpeedLeaves = @($motionLeaves | Where-Object {
        (Get-SemanticText -Value $_.Value) -match $isolatedSpeedAdjectivePattern
    })

    $speedProfilePresent = $shotProperties -contains "speed_profile"
    $directPlaybackRemap = $shotProperties -contains "playback_speed" -and
        (Test-ContainsPlaybackRemapCue -Value $shot.playback_speed)
    $speedProfileIsObject = $false
    $speedProfile = $null
    $speedProfileProperties = @()
    $validPlayback = ""
    $requiredSpeedBranches = New-Object System.Collections.ArrayList

    foreach ($speedLeaf in $strongSpeedLeaves) {
        $path = $speedLeaf.Path
        if ($path -match '(?i)\.(?:camera|camera[-_ ]?(?:movement|motion|speed))(?:\.|$)') {
            if (-not $requiredSpeedBranches.Contains("camera_speed")) {
                [void]$requiredSpeedBranches.Add("camera_speed")
            }
        }
        elseif ($path -match '(?i)\.(?:effect|effects|vfx|effect[-_ ]?(?:response[-_ ]?)?(?:movement|motion|speed)|environment|environment[-_ ]?(?:response[-_ ]?)?(?:movement|motion|speed))(?:\.|$)') {
            if (-not $requiredSpeedBranches.Contains("effect_response_speed")) {
                [void]$requiredSpeedBranches.Add("effect_response_speed")
            }
        }
        elseif ($path -match '(?i)\.(?:action|action[-_ ]?speed|performance|movement|motion|subject[-_ ]?(?:movement|motion|speed))(?:\.|$)') {
            if (-not $requiredSpeedBranches.Contains("action_speed")) {
                [void]$requiredSpeedBranches.Add("action_speed")
            }
        }
        elseif ($path -match '(?i)\.(?:description|prompt|video[-_ ]?prompt|shot[-_ ]?prompt|motion[-_ ]?prompt|blocking|staging|choreography)(?:\.|$)') {
            $executionText = Get-SemanticText -Value $speedLeaf.Value
            $mappedExecutionBranch = $false
            if ($executionText -match '(?i)(?:\u6444\u5f71\u673a|\u8fd0\u955c|\bcamera\b|\bdolly\b|\bgimbal\b|\u955c\u5934[^\u3002\uff01\uff1f\uff1b;\r\n]{0,10}(?:\u5feb\u901f|\u6781\u901f|\u7f13\u6162|\u6162\u901f|\u52a0\u901f|\u51cf\u901f|\u8ddf\u968f|\u63a8\u8fdb|\u540e\u9000|\u73af\u7ed5))') {
                if (-not $requiredSpeedBranches.Contains("camera_speed")) {
                    [void]$requiredSpeedBranches.Add("camera_speed")
                }
                $mappedExecutionBranch = $true
            }
            if ($executionText -match '(?i)(?:\u7279\u6548|\u73af\u5883|\u5c18\u571f|\u70df\u5c18|\u788e\u7247|\u80fd\u91cf|\u51b2\u51fb\u6ce2|\beffects?\b|\bvfx\b|\benvironment\b|\bdust\b|\bdebris\b|\bsmoke\b)') {
                if (-not $requiredSpeedBranches.Contains("effect_response_speed")) {
                    [void]$requiredSpeedBranches.Add("effect_response_speed")
                }
                $mappedExecutionBranch = $true
            }
            if (-not $mappedExecutionBranch -or
                $executionText -match '(?i)(?:\u89d2\u8272|\u4eba\u7269|\u4e3b\u4f53|\u8f66\u8f86|\u7269\u4f53|\u52a8\u4f5c|\u51b2\u523a|\u5954\u8dd1|\u6325\u62f3|\bcharacter\b|\bsubject\b|\bactor\b|\bvehicle\b|\bobject\b|\baction\b|\brun\b|\bsprint\b)') {
                if (-not $requiredSpeedBranches.Contains("action_speed")) {
                    [void]$requiredSpeedBranches.Add("action_speed")
                }
            }
        }
    }

    if ($speedProfilePresent) {
        if (-not (Test-JsonObject -Value $shot.speed_profile)) {
            Add-Issue -Issues $issues -Rule "invalid-speed-profile-type" -Shot $shotId -Message "speed_profile must be a JSON object when present."
        }
        else {
            $speedProfileIsObject = $true
            $speedProfile = $shot.speed_profile
            $speedProfileProperties = @($speedProfile.PSObject.Properties.Name)
        }
    }

    if (($strongSpeedLeaves.Count -gt 0 -or $directPlaybackRemap) -and -not $speedProfilePresent) {
        Add-Issue -Issues $issues -Rule "missing-speed-profile" -Shot $shotId -Message "Strong speed language in a motion field requires a structured speed_profile."
    }
    if ($directPlaybackRemap) {
        Add-Issue -Issues $issues -Rule "orphan-playback-speed" -Shot $shotId -Message "Shot-level playback_speed remapping must live inside speed_profile.playback_speed."
    }
    if ($isolatedSpeedLeaves.Count -gt 0 -and -not $speedProfileIsObject) {
        $paths = @($isolatedSpeedLeaves | ForEach-Object { $_.Path } | Select-Object -Unique)
        Add-Issue -Issues $issues -Rule "underspecified-speed-adjective" -Shot $shotId -Message "A speed adjective alone is not an executable motion instruction. Paths: $($paths -join ', ')"
    }

    if ($speedProfileIsObject) {
        if ($speedProfileProperties -notcontains "playback_speed") {
            Add-Issue -Issues $issues -Rule "missing-playback-speed" -Shot $shotId -Message "speed_profile.playback_speed is required and defaults to real-time."
        }
        elseif (-not (Test-JsonObject -Value $speedProfile.playback_speed)) {
            Add-Issue -Issues $issues -Rule "invalid-playback-speed-type" -Shot $shotId -Message "speed_profile.playback_speed must be a JSON object."
        }
        else {
            $playback = $speedProfile.playback_speed
            $playbackProperties = @($playback.PSObject.Properties.Name)
            if ($playbackProperties -notcontains "mode") {
                Add-Issue -Issues $issues -Rule "missing-playback-speed" -Shot $shotId -Message "speed_profile.playback_speed.mode is required."
            }
            elseif ($playback.mode -isnot [string] -or -not (Test-MeaningfulString -Value $playback.mode) -or
                (Get-SemanticText -Value $playback.mode) -cnotin $allowedPlaybackSpeeds) {
                Add-Issue -Issues $issues -Rule "invalid-playback-speed" -Shot $shotId -Message "speed_profile.playback_speed.mode must be exactly one of: $($allowedPlaybackSpeeds -join ', ')."
            }
            else {
                $validPlayback = Get-SemanticText -Value $playback.mode
            }

            $playbackFieldValid = @{}
            foreach ($playbackField in @("motivation", "enter_at", "duration", "exit_at", "story_function")) {
                if ($playbackProperties -notcontains $playbackField) {
                    Add-Issue -Issues $issues -Rule ("missing-playback-" + $playbackField.Replace("_", "-")) -Shot $shotId -Message "speed_profile.playback_speed.$playbackField is required."
                    $playbackFieldValid[$playbackField] = $false
                }
                elseif ($playback.($playbackField) -isnot [string] -or -not (Test-MeaningfulString -Value $playback.($playbackField))) {
                    Add-Issue -Issues $issues -Rule ("invalid-playback-" + $playbackField.Replace("_", "-")) -Shot $shotId -Message "speed_profile.playback_speed.$playbackField must be a semantically non-empty JSON string."
                    $playbackFieldValid[$playbackField] = $false
                }
                else {
                    $playbackFieldValid[$playbackField] = $true
                }
            }

            if ($playbackProperties -contains "motivation" -and $playback.motivation -is [string]) {
                $playbackMotivation = Get-SemanticText -Value $playback.motivation
                if ($validPlayback -ceq "real-time" -and $playbackMotivation -cne "none") {
                    Add-Issue -Issues $issues -Rule "invalid-playback-motivation" -Shot $shotId -Message "Real-time playback must use motivation=none."
                }
                elseif ($validPlayback -in @("slow-motion", "fast-motion") -and $playbackMotivation -cnotin $allowedMotionMotivations) {
                    Add-Issue -Issues $issues -Rule "invalid-playback-motivation" -Shot $shotId -Message "Playback remapping motivation must be exactly one of: $($allowedMotionMotivations -join ', ')."
                }
            }

            if ($validPlayback -in @("slow-motion", "fast-motion")) {
                foreach ($boundedField in @("enter_at", "duration", "exit_at", "story_function")) {
                    if ($playbackFieldValid[$boundedField] -and
                        -not (Test-ConcreteSpeedString -Value $playback.($boundedField))) {
                        Add-Issue -Issues $issues -Rule ("invalid-playback-" + $boundedField.Replace("_", "-")) -Shot $shotId -Message "Playback remapping requires a concrete $boundedField, not a placeholder."
                        $playbackFieldValid[$boundedField] = $false
                    }
                }

                if ($playbackFieldValid["story_function"] -and
                    (Get-SemanticText -Value $playback.story_function) -match $genericPlaybackStoryPattern) {
                    Add-Issue -Issues $issues -Rule "invalid-playback-story-function" -Shot $shotId -Message "Playback remapping story_function must name a concrete story change, not a generic style label."
                    $playbackFieldValid["story_function"] = $false
                }

                $playbackTimes = @{}
                foreach ($timeField in @("enter_at", "duration", "exit_at")) {
                    if (-not $playbackFieldValid[$timeField]) {
                        continue
                    }
                    try {
                        $playbackTimes[$timeField] = Convert-PlaybackTimeValueToSeconds -Value $playback.($timeField) -Field "speed_profile.playback_speed.$timeField"
                    }
                    catch {
                        Add-Issue -Issues $issues -Rule ("invalid-playback-" + $timeField.Replace("_", "-")) -Shot $shotId -Message $_.Exception.Message
                        $playbackFieldValid[$timeField] = $false
                    }
                }

                if ($playbackFieldValid["duration"] -and $playbackTimes["duration"] -le $epsilon) {
                    Add-Issue -Issues $issues -Rule "non-positive-playback-duration" -Shot $shotId -Message "Playback remapping duration must be greater than zero."
                }

                if ($playbackFieldValid["exit_at"]) {
                    $playbackExitText = Get-SemanticText -Value $playback.exit_at
                    if ($playbackExitText -notmatch $playbackReturnPattern -or
                        $playbackExitText -match $playbackReturnNegationPattern) {
                        Add-Issue -Issues $issues -Rule "invalid-playback-exit-at" -Shot $shotId -Message "Playback remapping exit_at must contain a positive, time-bounded return to real-time."
                        Add-Issue -Issues $issues -Rule "missing-playback-return" -Shot $shotId -Message "A slow-motion or fast-motion range must positively state when playback returns to real-time."
                    }
                }
                elseif ($playbackProperties -contains "exit_at" -and $playback.exit_at -is [string]) {
                    Add-Issue -Issues $issues -Rule "missing-playback-return" -Shot $shotId -Message "A slow-motion or fast-motion range must state when playback returns to real-time."
                }

                if ($playbackFieldValid["enter_at"] -and $playbackFieldValid["exit_at"] -and
                    $playbackTimes["exit_at"] -le ($playbackTimes["enter_at"] + $epsilon)) {
                    Add-Issue -Issues $issues -Rule "invalid-playback-range" -Shot $shotId -Message "Playback remapping exit_at must be later than enter_at."
                }

                if ($playbackFieldValid["enter_at"] -and $playbackFieldValid["duration"] -and $playbackFieldValid["exit_at"] -and
                    [Math]::Abs(($playbackTimes["exit_at"] - $playbackTimes["enter_at"]) - $playbackTimes["duration"]) -gt $epsilon) {
                    Add-Issue -Issues $issues -Rule "playback-duration-mismatch" -Shot $shotId -Message "Playback remapping duration must equal exit_at - enter_at."
                }

                $playbackShotStart = $null
                $playbackShotEnd = $null
                try {
                    if ($shotProperties -contains "start") {
                        $playbackShotStart = Convert-TimeValueToSeconds -Value $shot.start -Field "$shotId.start"
                    }
                    if ($shotProperties -contains "end") {
                        $playbackShotEnd = Convert-TimeValueToSeconds -Value $shot.end -Field "$shotId.end"
                    }
                }
                catch {
                    $playbackShotStart = $null
                    $playbackShotEnd = $null
                }

                if ($null -ne $playbackShotStart -and $null -ne $playbackShotEnd) {
                    $outsideShot = ($playbackFieldValid["enter_at"] -and
                            ($playbackTimes["enter_at"] -lt ($playbackShotStart - $epsilon) -or
                                $playbackTimes["enter_at"] -gt ($playbackShotEnd + $epsilon))) -or
                        ($playbackFieldValid["exit_at"] -and
                            ($playbackTimes["exit_at"] -lt ($playbackShotStart - $epsilon) -or
                                $playbackTimes["exit_at"] -gt ($playbackShotEnd + $epsilon))) -or
                        ($playbackFieldValid["duration"] -and
                            $playbackTimes["duration"] -gt (($playbackShotEnd - $playbackShotStart) + $epsilon))
                    if ($outsideShot) {
                        Add-Issue -Issues $issues -Rule "playback-range-outside-shot" -Shot $shotId -Message "Playback remapping enter_at, duration, and exit_at must stay within the shot interval."
                    }
                }
            }
        }

        foreach ($requiredBranch in @($requiredSpeedBranches)) {
            if ($speedProfileProperties -notcontains $requiredBranch) {
                Add-Issue -Issues $issues -Rule ("missing-" + $requiredBranch.Replace("_", "-") + "-profile") -Shot $shotId -Message "Strong motion speed language requires speed_profile.$requiredBranch."
            }
        }

        $presentMotionBranches = @($allowedSpeedBranches | Where-Object { $speedProfileProperties -contains $_ })
        if ($strongSpeedLeaves.Count -gt 0 -and $requiredSpeedBranches.Count -eq 0 -and $presentMotionBranches.Count -eq 0) {
            Add-Issue -Issues $issues -Rule "missing-speed-motion-branch" -Shot $shotId -Message "A generic speed cue requires at least one action_speed, camera_speed, or effect_response_speed branch."
        }

        foreach ($branchName in $presentMotionBranches) {
            $branch = $speedProfile.($branchName)
            if (-not (Test-JsonObject -Value $branch)) {
                Add-Issue -Issues $issues -Rule "invalid-speed-branch-type" -Shot $shotId -Message "speed_profile.$branchName must be a JSON object."
                continue
            }

            $branchProperties = @($branch.PSObject.Properties.Name)
            foreach ($requiredField in @(
                [pscustomobject]@{ Name = "target"; MissingRule = "missing-speed-target"; InvalidRule = "invalid-speed-target" },
                [pscustomobject]@{ Name = "local_range_or_trigger"; MissingRule = "missing-speed-local-range"; InvalidRule = "invalid-speed-local-range" },
                [pscustomobject]@{ Name = "phase_curve"; MissingRule = "missing-speed-phase"; InvalidRule = "invalid-speed-phase" },
                [pscustomobject]@{ Name = "path_or_relation"; MissingRule = "missing-speed-path-or-relation"; InvalidRule = "invalid-speed-path-or-relation" },
                [pscustomobject]@{ Name = "readability_anchor"; MissingRule = "missing-speed-readability-anchor"; InvalidRule = "invalid-speed-readability-anchor" },
                [pscustomobject]@{ Name = "result_anchor"; MissingRule = "missing-speed-result-anchor"; InvalidRule = "invalid-speed-result-anchor" }
            )) {
                if ($branchProperties -notcontains $requiredField.Name) {
                    Add-Issue -Issues $issues -Rule $requiredField.MissingRule -Shot $shotId -Message "speed_profile.$branchName.$($requiredField.Name) is required."
                }
                elseif ($branch.($requiredField.Name) -isnot [string] -or
                    -not (Test-ConcreteSpeedString -Value $branch.($requiredField.Name))) {
                    Add-Issue -Issues $issues -Rule $requiredField.InvalidRule -Shot $shotId -Message "speed_profile.$branchName.$($requiredField.Name) must be a concrete, semantically non-empty JSON string rather than a placeholder."
                }
                elseif ($requiredField.Name -eq "phase_curve" -and
                    (Get-SemanticText -Value $branch.phase_curve) -notmatch $speedPhaseSignalPattern) {
                    Add-Issue -Issues $issues -Rule "invalid-speed-phase" -Shot $shotId -Message "speed_profile.$branchName.phase_curve must contain an executable speed stage or response curve."
                }
            }
        }
    }

    $hasSlowMotion = @($shotLeaves | Where-Object {
        (Get-SemanticText -Value $_.Value) -match $slowMotionPattern
    }).Count -gt 0
    if ($hasSlowMotion -and ($fillerLeaves.Count -gt 0 -or $fillerPropertyNodes.Count -gt 0)) {
        Add-Issue -Issues $issues -Rule "slow-motion-duration-padding" -Shot $shotId -Message "Slow motion cannot be used to pad or fill a target duration."
    }

    $teleportLeaves = @($motionLeaves | Where-Object {
        Test-HasAffirmativeTeleportCue -Value $_.Value
    })
    $movementMode = ""
    $movementModeValid = $false
    if ($shotProperties -contains "movement_mode") {
        if ($shot.movement_mode -isnot [string] -or -not (Test-MeaningfulString -Value $shot.movement_mode) -or
            (Get-SemanticText -Value $shot.movement_mode) -cnotin $allowedMovementModes) {
            Add-Issue -Issues $issues -Rule "invalid-movement-mode" -Shot $shotId -Message "movement_mode must be exactly one of: $($allowedMovementModes -join ', ')."
        }
        else {
            $movementMode = Get-SemanticText -Value $shot.movement_mode
            $movementModeValid = $true
        }
    }

    $declaredTeleport = $movementModeValid -and $movementMode -ceq "teleportation"
    if ($teleportLeaves.Count -gt 0 -and -not $declaredTeleport) {
        Add-Issue -Issues $issues -Rule "speed-teleport-substitution" -Shot $shotId -Message "Physical high speed must not become teleport-like displacement. Declare a real teleportation event with movement_mode, motivation, trigger, and arrival_state."
    }

    if ($declaredTeleport) {
        if ($shotProperties -notcontains "motivation") {
            Add-Issue -Issues $issues -Rule "missing-teleport-motivation" -Shot $shotId -Message "Teleportation requires motivation."
        }
        elseif ($shot.motivation -isnot [string] -or -not (Test-MeaningfulString -Value $shot.motivation) -or
            (Get-SemanticText -Value $shot.motivation) -cnotin $allowedMotionMotivations) {
            Add-Issue -Issues $issues -Rule "invalid-teleport-motivation" -Shot $shotId -Message "Teleportation motivation must be exactly one of: $($allowedMotionMotivations -join ', ')."
        }

        foreach ($teleportField in @(
            [pscustomobject]@{ Name = "trigger"; MissingRule = "missing-teleport-trigger"; InvalidRule = "invalid-teleport-trigger" },
            [pscustomobject]@{ Name = "arrival_state"; MissingRule = "missing-teleport-arrival-state"; InvalidRule = "invalid-teleport-arrival-state" }
        )) {
            if ($shotProperties -notcontains $teleportField.Name) {
                Add-Issue -Issues $issues -Rule $teleportField.MissingRule -Shot $shotId -Message "Teleportation requires $($teleportField.Name)."
            }
            elseif ($shot.($teleportField.Name) -isnot [string] -or
                -not (Test-ConcreteSpeedString -Value $shot.($teleportField.Name))) {
                Add-Issue -Issues $issues -Rule $teleportField.InvalidRule -Shot $shotId -Message "$($teleportField.Name) must be a concrete, semantically non-empty JSON string rather than a placeholder."
            }
        }
    }

    $start = $null
    $end = $null
    $startValid = $true
    $endValid = $true
    if ($shotProperties -notcontains "start") {
        Add-Issue -Issues $issues -Rule "invalid-shot-time" -Shot $shotId -Message "Missing required start."
        $startValid = $false
    }
    else {
        try { $start = Convert-TimeValueToSeconds -Value $shot.start -Field "$shotId.start" }
        catch {
            Add-Issue -Issues $issues -Rule "invalid-shot-time" -Shot $shotId -Message $_.Exception.Message
            $startValid = $false
        }
    }
    if ($shotProperties -notcontains "end") {
        Add-Issue -Issues $issues -Rule "invalid-shot-time" -Shot $shotId -Message "Missing required end."
        $endValid = $false
    }
    else {
        try { $end = Convert-TimeValueToSeconds -Value $shot.end -Field "$shotId.end" }
        catch {
            Add-Issue -Issues $issues -Rule "invalid-shot-time" -Shot $shotId -Message $_.Exception.Message
            $endValid = $false
        }
    }

    $storyFunction = ""
    if ($shotProperties -notcontains "storyFunction") {
        Add-Issue -Issues $issues -Rule "missing-story-function" -Shot $shotId -Message "Every shot must state its concrete story advance."
    }
    elseif ($shot.storyFunction -isnot [string]) {
        Add-Issue -Issues $issues -Rule "invalid-story-function-type" -Shot $shotId -Message "storyFunction must be a JSON string."
    }
    elseif (-not (Test-MeaningfulString -Value $shot.storyFunction)) {
        Add-Issue -Issues $issues -Rule "missing-story-function" -Shot $shotId -Message "storyFunction must be semantically non-empty."
    }
    else {
        $storyFunction = Get-SemanticText -Value $shot.storyFunction
        if ($storyFunction -match $fillerPattern) {
            Add-Issue -Issues $issues -Rule "invalid-story-function" -Shot $shotId -Message "Filler, padding, and isolated reaction are not valid story functions."
        }
    }

    $storyFunctionType = ""
    if ($shotProperties -notcontains "storyFunctionType") {
        Add-Issue -Issues $issues -Rule "missing-story-function-type" -Shot $shotId -Message "Every shot must classify storyFunctionType."
    }
    elseif ($shot.storyFunctionType -isnot [string]) {
        Add-Issue -Issues $issues -Rule "invalid-story-function-type" -Shot $shotId -Message "storyFunctionType must be a JSON string."
    }
    elseif (-not (Test-MeaningfulString -Value $shot.storyFunctionType)) {
        Add-Issue -Issues $issues -Rule "missing-story-function-type" -Shot $shotId -Message "storyFunctionType must be semantically non-empty."
    }
    else {
        $storyFunctionType = Get-SemanticText -Value $shot.storyFunctionType
        if ($storyFunctionType -cnotin $allowedStoryFunctionTypes) {
            Add-Issue -Issues $issues -Rule "invalid-story-function-type" -Shot $shotId -Message "storyFunctionType '$storyFunctionType' is not an exact-case allowed category."
        }
    }

    $shotKind = ""
    if ($shotProperties -notcontains "kind") {
        Add-Issue -Issues $issues -Rule "missing-shot-kind" -Shot $shotId -Message "Every shot must have a canonical kind."
    }
    elseif ($shot.kind -isnot [string]) {
        Add-Issue -Issues $issues -Rule "invalid-shot-kind-type" -Shot $shotId -Message "kind must be a JSON string."
    }
    elseif (-not (Test-MeaningfulString -Value $shot.kind)) {
        Add-Issue -Issues $issues -Rule "missing-shot-kind" -Shot $shotId -Message "kind must be semantically non-empty."
    }
    else {
        $shotKind = Get-SemanticText -Value $shot.kind
        if ($shotKind -cnotin $allowedShotKinds) {
            Add-Issue -Issues $issues -Rule "invalid-shot-kind" -Shot $shotId -Message "kind '$shotKind' is not an exact-case allowed category."
        }
    }

    foreach ($optionalTextField in @("shotType", "beatType", "description", "purpose", "action", "performance", "notes")) {
        if ($shotProperties -contains $optionalTextField) {
            if ($shot.$optionalTextField -isnot [string] -or -not (Test-MeaningfulString -Value $shot.$optionalTextField)) {
                Add-Issue -Issues $issues -Rule "invalid-shot-scalar-type" -Shot $shotId -Message "$optionalTextField must be a semantically non-empty JSON string when present."
            }
        }
    }

    $isStandaloneReaction = $false
    if ($shotProperties -contains "standaloneReaction") {
        if ($shot.standaloneReaction -isnot [bool]) {
            Add-Issue -Issues $issues -Rule "invalid-standalone-reaction-type" -Shot $shotId -Message "standaloneReaction must be a JSON boolean."
        }
        else {
            $isStandaloneReaction = [bool]$shot.standaloneReaction
        }
    }
    if ($isStandaloneReaction) {
        Add-Issue -Issues $issues -Rule "standalone-reaction-filler" -Shot $shotId -Message "Immediate reaction must overlap an effective action instead of occupying a standalone shot."
    }

    $isReaction = $shotKind -ceq "reaction"
    if (-not $isReaction) {
        $isReaction = @($shotLeaves | Where-Object { (Get-SemanticText -Value $_.Value) -match $reactionAliasPattern }).Count -gt 0
    }
    if (-not $isReaction) {
        $isReaction = @($shotPropertyNodes | Where-Object { (Get-SemanticText -Value $_.Name) -match $reactionAliasPattern }).Count -gt 0
    }

    $stateChangeValid = $false
    $exitPointValid = $false
    if ($shotProperties -contains "stateChange") {
        if ($shot.stateChange -isnot [string]) {
            Add-Issue -Issues $issues -Rule "invalid-reaction-justification-type" -Shot $shotId -Message "stateChange must be a JSON string."
        }
        elseif (Test-MeaningfulString -Value $shot.stateChange) {
            $stateChangeValid = Test-ReactionJustification -Value $shot.stateChange -Role "StateChange"
        }
    }
    if ($shotProperties -contains "exitPoint") {
        if ($shot.exitPoint -isnot [string]) {
            Add-Issue -Issues $issues -Rule "invalid-reaction-justification-type" -Shot $shotId -Message "exitPoint must be a JSON string."
        }
        elseif (Test-MeaningfulString -Value $shot.exitPoint) {
            $exitPointValid = Test-ReactionJustification -Value $shot.exitPoint -Role "ExitPoint"
        }
    }

    if ($startValid -and $endValid) {
        $shotDuration = $end - $start
        if ($shotDuration -le $epsilon) {
            Add-Issue -Issues $issues -Rule "non-positive-duration" -Shot $shotId -Message "Shot end must be later than shot start."
        }

        if ($isReaction -and $shotDuration -gt (0.5 + $epsilon)) {
            if (-not $stateChangeValid -or -not $exitPointValid) {
                Add-Issue -Issues $issues -Rule "unjustified-long-reaction" -Shot $shotId -Message "A reaction longer than 0.5 seconds needs a concrete observable stateChange and an explicit exitPoint trigger. Placeholder, no-change, and generic labels are invalid."
            }
            if (($stateChangeValid -and (Get-SemanticText -Value $shot.stateChange) -match $fillerPattern) -or
                ($exitPointValid -and (Get-SemanticText -Value $shot.exitPoint) -match $fillerPattern)) {
                Add-Issue -Issues $issues -Rule "invalid-reaction-justification" -Shot $shotId -Message "Reaction justification must describe real state changes, not filler."
            }
            elseif (($shotProperties -contains "stateChange" -and $shot.stateChange -is [string] -and
                    (Test-MeaningfulString -Value $shot.stateChange) -and -not $stateChangeValid) -or
                ($shotProperties -contains "exitPoint" -and $shot.exitPoint -is [string] -and
                    (Test-MeaningfulString -Value $shot.exitPoint) -and -not $exitPointValid)) {
                Add-Issue -Issues $issues -Rule "invalid-reaction-justification" -Shot $shotId -Message "Reaction justification must name an actual observable change and a concrete handoff or exit event."
            }
        }

        if ($validTemporalShotCount -eq 0 -and [Math]::Abs($start) -gt $epsilon) {
            Add-Issue -Issues $issues -Rule "timeline-not-zero-based" -Shot $shotId -Message "The first valid shot must start at 00:00."
        }
        elseif ($validTemporalShotCount -gt 0 -and [Math]::Abs($start - $previousEnd) -gt $epsilon) {
            $timelineIssue = if ($start -gt $previousEnd) { "gap" } else { "overlap" }
            Add-Issue -Issues $issues -Rule "gap-or-overlap" -Shot $shotId -Message "Timeline ${timelineIssue}: start=$start previousEnd=$previousEnd."
        }

        $previousEnd = $end
        $lastEnd = $end
        $validTemporalShotCount++
    }

    $keyframes = @()
    if ($shotProperties -contains "keyframes") {
        if ($shot.keyframes -isnot [System.Array]) {
            Add-Issue -Issues $issues -Rule "invalid-keyframes-type" -Shot $shotId -Message "keyframes must be a JSON array when present."
        }
        else {
            $keyframes = @($shot.keyframes)
        }
    }

    $previousKeyframeAt = $null
    for ($keyframeIndex = 0; $keyframeIndex -lt $keyframes.Count; $keyframeIndex++) {
        $keyframe = $keyframes[$keyframeIndex]
        $fallbackKeyframeId = "$shotId.keyframe-$($keyframeIndex + 1)"
        if (-not (Test-JsonObject -Value $keyframe)) {
            Add-Issue -Issues $issues -Rule "invalid-keyframe-type" -Shot $fallbackKeyframeId -Message "Every keyframes entry must be a JSON object."
            continue
        }

        $keyframeProperties = @($keyframe.PSObject.Properties.Name)
        $keyframeId = $fallbackKeyframeId
        if ($keyframeProperties -notcontains "id") {
            Add-Issue -Issues $issues -Rule "missing-keyframe-id" -Shot $keyframeId -Message "Every keyframe must have a stable string id."
        }
        elseif ($keyframe.id -isnot [string]) {
            Add-Issue -Issues $issues -Rule "invalid-keyframe-id-type" -Shot $keyframeId -Message "Keyframe id must be a JSON string."
        }
        elseif (-not (Test-MeaningfulString -Value $keyframe.id)) {
            Add-Issue -Issues $issues -Rule "missing-keyframe-id" -Shot $keyframeId -Message "Keyframe id must be semantically non-empty."
        }
        else {
            $keyframeId = Get-SemanticText -Value $keyframe.id
            if ($seenKeyframeIds.ContainsKey($keyframeId) -or $seenIds.ContainsKey($keyframeId)) {
                Add-Issue -Issues $issues -Rule "duplicate-keyframe-id" -Shot $keyframeId -Message "Keyframe ids must be unique after normalization."
            }
            else {
                $seenKeyframeIds[$keyframeId] = $true
            }
        }

        if ($keyframeProperties -notcontains "at") {
            Add-Issue -Issues $issues -Rule "invalid-keyframe-time" -Shot $keyframeId -Message "Missing required keyframe at."
            continue
        }

        try {
            $keyframeAt = Convert-TimeValueToSeconds -Value $keyframe.at -Field "$keyframeId.at"
        }
        catch {
            Add-Issue -Issues $issues -Rule "invalid-keyframe-time" -Shot $keyframeId -Message $_.Exception.Message
            continue
        }

        if ($startValid -and $endValid -and
            ($keyframeAt -lt ($start - $epsilon) -or $keyframeAt -gt ($end + $epsilon))) {
            Add-Issue -Issues $issues -Rule "keyframe-outside-shot" -Shot $keyframeId -Message "Keyframe time must fall within its shot."
        }
        if ($null -ne $previousKeyframeAt -and $keyframeAt -le $previousKeyframeAt) {
            Add-Issue -Issues $issues -Rule "keyframe-order" -Shot $keyframeId -Message "Keyframes must be listed in strictly increasing time order."
        }
        $previousKeyframeAt = $keyframeAt
    }
}

$fightMetrics = Invoke-FightSequenceValidation `
    -Data $data `
    -RootProperties $rootProperties `
    -ExpectedTotal $expectedTotal `
    -Shots $shots `
    -Issues $issues `
    -Epsilon $epsilon

if ($null -ne $expectedTotal -and [Math]::Abs($lastEnd - $expectedTotal) -gt $epsilon) {
    Add-Issue -Issues $issues -Rule "total-duration-mismatch" -Shot "" -Message "The final valid shot end does not match totalDuration."
}

$result = [pscustomobject]@{
    input = $resolvedInput
    totalDurationSeconds = $expectedTotal
    shotCount = $shots.Count
    issueCount = $issues.Count
    issues = @($issues)
}

if ($Format -eq "Json") {
    $result | ConvertTo-Json -Depth 6
}
else {
    "Checked $($result.shotCount) storyboard shot(s)."
    if ($issues.Count -eq 0) {
        "Timeline is continuous and matches the declared total duration."
    }
    else {
        "Found $($issues.Count) timeline issue(s):"
        foreach ($issue in $issues) {
            "- [$($issue.rule)] $($issue.shot): $($issue.message)"
        }
    }
}

if ($issues.Count -gt 0) { exit 1 }
exit 0
