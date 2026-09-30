const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;

const ROOT = __dirname;

const UPLOAD_DIR = path.join(ROOT, "uploads");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const TEMP_DIR = path.join(ROOT, "temp");

for (const dir of [
    UPLOAD_DIR,
    OUTPUT_DIR,
    TEMP_DIR
]) {
    fs.mkdirSync(dir, { recursive: true });
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(ROOT));

const upload = multer({
    dest: UPLOAD_DIR,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024
    }
});


/* =========================================================
   UTILITIES
========================================================= */

function safeName(value) {

    return String(value || "output")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "output";

}


function isYouTubeUrl(value) {

    try {

        const u = new URL(value);

        return [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "youtu.be",
            "www.youtu.be"
        ].includes(u.hostname);

    } catch {

        return false;

    }

}


function runCommand(command, args, options = {}) {

    return new Promise((resolve, reject) => {

        const child = spawn(command, args, {
            windowsHide: true,
            ...options
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", data => {
            stdout += data.toString();
        });

        child.stderr.on("data", data => {
            stderr += data.toString();
        });

        child.on("error", error => {
            reject(error);
        });

        child.on("close", code => {

            if (code === 0) {

                resolve({
                    stdout,
                    stderr
                });

            } else {

                const error = new Error(
                    `${command} exited with code ${code}\n${stderr.slice(-4000)}`
                );

                error.code = code;
                error.stderr = stderr;

                reject(error);

            }

        });

    });

}


async function commandExists(command) {

    try {

        await runCommand(
            process.platform === "win32"
                ? "where"
                : "which",
            [command]
        );

        return true;

    } catch {

        return false;

    }

}


function parseVTT(text) {

    const lines = text
        .replace(/\r/g, "")
        .split("\n");

    const cues = [];

    let i = 0;

    while (i < lines.length) {

        const line = lines[i].trim();

        if (
            line.includes("-->") &&
            line.split("-->").length >= 2
        ) {

            const parts = line.split("-->");

            const start = parseVttTime(
                parts[0].trim()
            );

            const end = parseVttTime(
                parts[1]
                    .trim()
                    .split(" ")[0]
            );

            i++;

            const textLines = [];

            while (
                i < lines.length &&
                lines[i].trim() !== ""
            ) {

                textLines.push(
                    lines[i].trim()
                );

                i++;

            }

            const cueText = textLines
                .join(" ")
                .replace(/<[^>]+>/g, "")
                .replace(/\s+/g, " ")
                .trim();

            if (cueText) {

                cues.push({
                    start,
                    end,
                    text: cueText
                });

            }

        }

        i++;

    }

    return cues;

}


function parseVttTime(value) {

    const clean = value.trim();

    const parts = clean.split(":");

    if (parts.length === 3) {

        const h = Number(parts[0]);
        const m = Number(parts[1]);
        const s = Number(parts[2].replace(",", "."));

        return h * 3600 + m * 60 + s;

    }

    if (parts.length === 2) {

        const m = Number(parts[0]);
        const s = Number(parts[1].replace(",", "."));

        return m * 60 + s;

    }

    return 0;

}


function cleanSubtitle(text) {

    return String(text || "")
        .replace(
            /^\s*(David|Sarah|Emma|Leo|Narrator|Speaker|Character)\s*:\s*/i,
            ""
        )
        .replace(/^\s*[-–—]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

}


function makeBlueprint(metadata, transcript) {

    const words = transcript
        .split(/\s+/)
        .filter(Boolean);

    const sentences =
        transcript
            .split(/[.!?]+/)
            .map(x => x.trim())
            .filter(Boolean);

    const averageSentenceLength =
        sentences.length
            ? Math.round(
                words.length / sentences.length
            )
            : 0;

    const transcriptSample =
        transcript.slice(0, 1800);

    let suggestedTopic =
        "An original everyday English-learning adventure";

    const lower =
        transcript.toLowerCase();

    if (
        lower.includes("airport") ||
        lower.includes("flight") ||
        lower.includes("passport")
    ) {

        suggestedTopic =
            "A family prepares for an international trip";

    } else if (
        lower.includes("restaurant") ||
        lower.includes("food") ||
        lower.includes("order")
    ) {

        suggestedTopic =
            "A family learns useful English at a restaurant";

    } else if (
        lower.includes("school") ||
        lower.includes("class") ||
        lower.includes("teacher")
    ) {

        suggestedTopic =
            "A student starts a new school day";

    } else if (
        lower.includes("office") ||
        lower.includes("meeting") ||
        lower.includes("work")
    ) {

        suggestedTopic =
            "A young professional handles an important workday";

    }

    return {

        title:
            metadata.title ||
            "Reference Video",

        hookStyle:
            "Start immediately with a recognizable everyday situation",

        pacing:
            "Short visual beats with frequent conversational exchanges",

        sceneCadence:
            "Approximately 8–12 seconds per visual beat",

        dialoguePattern:
            "Natural spoken English using short conversational turns",

        educationalStyle:
            "Context-based vocabulary and practical spoken English",

        visualPattern:
            "Consistent family-friendly animated storytelling",

        cameraPattern:
            "Mix of establishing shots, medium dialogue shots and close-ups",

        subtitleStyle:
            "Bottom-center white English subtitles with dark outline",

        speakerNamesOnScreen:
            false,

        averageSentenceLength,

        estimatedWords:
            words.length,

        suggestedTopic,

        transcriptSample

    };

}


/* =========================================================
   YOUTUBE ANALYSIS
========================================================= */

async function analyzeYouTube(url) {

    if (!isYouTubeUrl(url)) {

        throw new Error(
            "Please enter a valid YouTube URL."
        );

    }

    const hasYtDlp =
        await commandExists("yt-dlp");

    if (!hasYtDlp) {

        throw new Error(
            "yt-dlp is not installed on the server. " +
            "Use the supplied Dockerfile or install yt-dlp."
        );

    }

    const id =
        crypto
            .randomBytes(8)
            .toString("hex");

    const workDir =
        path.join(TEMP_DIR, `yt-${id}`);

    fs.mkdirSync(workDir, {
        recursive: true
    });

    try {

        const infoResult = await runCommand(
            "yt-dlp",
            [
                "--skip-download",
                "--no-warnings",
                "--dump-single-json",
                url
            ]
        );

        let info;

        try {

            info = JSON.parse(
                infoResult.stdout
            );

        } catch {

            throw new Error(
                "Could not read YouTube metadata."
            );

        }

        let transcript = "";

        let captionAvailable = false;

        const subtitles =
            info.subtitles || {};

        const automatic =
            info.automatic_captions || {};

        let lang = null;

        const languagePriority = [
            "en",
            "en-US",
            "en-GB",
            "en-orig"
        ];

        for (const candidate of languagePriority) {

            if (
                subtitles[candidate] ||
                automatic[candidate]
            ) {

                lang = candidate;
                break;

            }

        }

        if (!lang) {

            const keys = [
                ...Object.keys(subtitles),
                ...Object.keys(automatic)
            ];

            lang = keys.find(
                x => x.toLowerCase().startsWith("en")
            );

        }

        if (lang) {

            captionAvailable = true;

            const outputTemplate =
                path.join(
                    workDir,
                    "captions"
                );

            try {

                await runCommand(
                    "yt-dlp",
                    [
                        "--skip-download",
                        "--no-warnings",
                        "--write-auto-subs",
                        "--write-subs",
                        "--sub-langs",
                        lang,
                        "--sub-format",
                        "vtt",
                        "--output",
                        outputTemplate,
                        url
                    ]
                );

            } catch (captionError) {

                console.warn(
                    "Caption download warning:",
                    captionError.message
                );

            }

            const files =
                fs.readdirSync(workDir);

            const vttFile =
                files.find(
                    file =>
                        file.endsWith(".vtt")
                );

            if (vttFile) {

                const vtt =
                    fs.readFileSync(
                        path.join(workDir, vttFile),
                        "utf8"
                    );

                const cues =
                    parseVTT(vtt);

                transcript =
                    cues
                        .map(c => cleanSubtitle(c.text))
                        .filter(Boolean)
                        .join(" ");

            }

        }

        const metadata = {

            title:
                info.title ||
                "Untitled YouTube Video",

            channel:
                info.uploader ||
                info.channel ||
                "Unknown",

            duration:
                Number(info.duration || 0),

            thumbnail:
                info.thumbnail || "",

            webpage_url:
                info.webpage_url ||
                url

        };

        const blueprint =
            makeBlueprint(
                metadata,
                transcript
            );

        return {

            ...metadata,

            captionAvailable,

            transcript,

            blueprint

        };

    } finally {

        fs.rmSync(
            workDir,
            {
                recursive:true,
                force:true
            }
        );

    }

}


/* =========================================================
   STORY GENERATION
========================================================= */

const CHARACTERS = {

    David: {
        role:"Father",
        description:
`42-year-old adult male with a friendly oval face,
large expressive dark brown eyes, short neat black hair
with a few natural gray strands, warm medium-light natural
skin tone, average adult male proportions, light blue shirt,
navy trousers, white sneakers and silver wristwatch.`
    },

    Sarah: {
        role:"Mother",
        description:
`39-year-old adult female with a kind oval face,
large expressive dark brown eyes, shoulder-length dark brown hair,
warm natural skin tone, average adult female proportions,
pink cardigan, white blouse, beige trousers,
white sneakers and beige handbag.`
    },

    Emma: {
        role:"Daughter",
        description:
`12-year-old girl with a cheerful youthful face,
large expressive dark brown eyes, long dark brown ponytail,
natural warm skin tone, yellow hoodie, blue jeans,
white sneakers and pink backpack.`
    },

    Leo: {
        role:"Son",
        description:
`9-year-old boy with a cheerful child face,
large expressive dark brown eyes, short slightly messy black hair,
natural warm skin tone, green T-shirt, blue shorts,
white sneakers and blue backpack.`
    }

};


function selectCharacter(index, level) {

    const names =
        level === "A1"
            ? ["David","Sarah","Emma","Leo"]
            : ["David","Sarah","Emma","Leo"];

    return names[
        index % names.length
    ];

}


function locationForScene(index) {

    if (index < 5)
        return "Modern family home";

    if (index < 10)
        return "Family car";

    if (index < 18)
        return "Modern international airport";

    if (index < 24)
        return "Airport departure gate";

    if (index < 28)
        return "Modern family restaurant";

    return "Beautiful city park";

}


function cameraForScene(index) {

    const cameras = [

        "Wide cinematic establishing shot",
        "Medium family dialogue shot",
        "Close-up expressive character shot",
        "Over-the-shoulder conversation shot",
        "Tracking cinematic shot"

    ];

    return cameras[
        index % cameras.length
    ];

}


function generateDialogue(index, topic, level) {

    const dialogues = [

        ["David","Good morning, everyone. Are you ready?"],
        ["Emma","Yes! I am very excited about today."],
        ["Sarah","Let's check everything before we leave."],
        ["Leo","I have my bag and everything I need."],
        ["David","Great. Then let's get started."],
        ["Emma","What should we do first?"],
        ["Sarah","First, we need to make sure we have our documents."],
        ["Leo","I have mine right here."],
        ["David","Excellent. Now we can continue."],
        ["Emma","This place is bigger than I expected."],
        ["Sarah","Stay together and follow the signs."],
        ["Leo","I can see the sign over there."],
        ["David","Good job. Let's go this way."],
        ["Emma","Can I ask a question?"],
        ["Sarah","Of course. What would you like to know?"],
        ["Emma","How do we know where to go next?"],
        ["David","We can check the information screen."],
        ["Leo","I found it! Look at the screen."],
        ["Sarah","Wonderful. Everything is on time."],
        ["Emma","I am learning so many new words today."],
        ["David","That is the best way to learn English."],
        ["Leo","Practice makes things easier."],
        ["Sarah","Exactly. Let's keep practicing together."],
        ["Emma","I feel much more confident now."],
        ["David","You should. You are doing very well."],
        ["Leo","Can we celebrate after this?"],
        ["Sarah","Of course. We can have a nice meal together."],
        ["Emma","That sounds perfect."],
        ["David","Today was a great learning experience."],
        ["Sarah","And we learned by using English in real situations."]
    ];

    let pair =
        dialogues[
            index % dialogues.length
        ];

    if(level === "A1") {

        pair = [
            pair[0],
            pair[1]
                .replace(
                    /wonderful/gi,
                    "great"
                )
                .replace(
                    /confident/gi,
                    "ready"
                )
        ];

    }

    return pair;

}


function buildScene(index, total, topic, level) {

    const [speaker, dialogue] =
        generateDialogue(
            index,
            topic,
            level
        );

    const location =
        locationForScene(index);

    const action =
        `The family continues the original story.
${speaker} speaks naturally while the other characters
react with friendly and expressive body language.`;

    const camera =
        cameraForScene(index);

    const character =
        CHARACTERS[speaker];

    const prompt = `SCENE ${index+1}

MASTER VISUAL STYLE

Premium cinematic 3D animated family-learning video.
Pixar-inspired 3D family animation aesthetic.
Disney-inspired family animation visual language.
Cute appealing stylized characters.
Large expressive eyes.
Stable facial proportions.
Stable body proportions.
Premium polished 3D character modeling.
Natural body language.
Warm friendly expressions.
Detailed environment.
Soft cinematic lighting.
Vibrant family-friendly colors.
Professional animated feature quality.

CHARACTER CONSISTENCY

Existing character identity is immutable.
Keep identical face, eyes, hair, skin tone, body proportions,
age, clothing, shoes and accessories.

CHARACTER:
${speaker}

CHARACTER DETAILS:
${character.description}

LOCATION:
${location}

ACTION:
${action}

EMOTION:
Friendly, natural, curious and expressive.

CAMERA:
${camera}

DIALOGUE:
${dialogue}

SUBTITLE:
${cleanSubtitle(dialogue)}

SUBTITLE RULE:
Bottom center.
White bold English text.
Thin dark outline.
Soft shadow.
Speech synchronized.
NO SPEAKER NAME.

TIMING:
10 seconds.

FORMAT:
16:9 LANDSCAPE.

NEGATIVE:
No live action.
No photorealistic human cinema.
No anime.
No manga.
No flat illustration.
No character redesign.
No face replacement.
No hairstyle change.
No clothing change.
No age change.
No random text.
No watermark.
No logo.
No distorted face.
No duplicate character.

FINAL:
Create one polished cinematic English-learning animation scene.
Maintain exact character identity.
Only the spoken English subtitle may intentionally appear as text.`;

    return {

        id:index+1,

        start:index*10,

        end:(index+1)*10,

        speaker,

        characters:[speaker],

        location,

        action,

        camera,

        dialogue,

        subtitle:
            cleanSubtitle(dialogue),

        prompt

    };

}


function createProject(body) {

    const level =
        body.level || "A1";

    const duration =
        Math.max(
            60,
            Math.min(
                600,
                Number(body.duration || 300)
            )
        );

    const sceneCount =
        Math.ceil(duration / 10);

    const title =
        body.title ||
        body.topic ||
        "Original English Learning Story";

    const topic =
        body.topic ||
        "An everyday English-learning adventure";

    const scenes = [];

    for (
        let i=0;
        i<sceneCount;
        i++
    ) {

        scenes.push(
            buildScene(
                i,
                sceneCount,
                topic,
                level
            )
        );

    }

    const story = {

        title,

        topic,

        direction:
            body.direction || "",

        level,

        duration,

        logline:
            `An original English-learning story about ${topic}.`,

        summary:
            `A group of characters experience an everyday situation,
solve a small problem and learn practical English through natural
conversation.`,

        learningObjectives:[
            "Practical spoken English",
            "Everyday vocabulary",
            "Listening through context",
            "Natural conversation"
        ]

    };

    return {
        story,
        scenes
    };

}


/* =========================================================
   SRT
========================================================= */

function srtTimestamp(seconds) {

    const h =
        Math.floor(seconds / 3600);

    const m =
        Math.floor(
            (seconds % 3600) / 60
        );

    const s =
        Math.floor(seconds % 60);

    const ms =
        Math.floor(
            (seconds -
                Math.floor(seconds)) * 1000
        );

    return (
        String(h).padStart(2,"0") +
        ":" +
        String(m).padStart(2,"0") +
        ":" +
        String(s).padStart(2,"0") +
        "," +
        String(ms).padStart(3,"0")
    );

}


function buildSRT(scenes) {

    return scenes
        .map((scene,index) => {

            const text =
                cleanSubtitle(
                    scene.dialogue ||
                    scene.subtitle
                );

            return (
`${index+1}
${srtTimestamp(scene.start)} --> ${srtTimestamp(scene.end)}
${text}`
            );

        })
        .join("\n\n");

}


/* =========================================================
   YOUTUBE PACK
========================================================= */

function makeYouTubePack(story, scenes) {

    const title =
        story.title ||
        "Easy English Story for Beginners";

    const description =
`${title}

Learn practical English through an original animated story.

This video is designed for English learners and includes:
• Natural English conversation
• Useful everyday vocabulary
• Clear spoken sentences
• English subtitles
• Family-friendly animated storytelling

Level: ${story.level || "A1"}

Use the subtitles to listen, repeat and practice.

This is an original story created for English-learning purposes.

#EnglishLearning
#LearnEnglish
#EnglishConversation
#EasyEnglish
#EnglishStory
#EnglishSpeaking`;

    const tags =
[
    "learn english",
    "english learning",
    "easy english",
    "english conversation",
    "english story",
    "english speaking practice",
    "english subtitles",
    "beginner english",
    "A1 English",
    "English listening",
    "spoken English",
    "daily English"
].join(", ");

    return {
        title,
        description,
        tags
    };

}


/* =========================================================
   API ROUTES
========================================================= */

app.post(
    "/api/analyze-youtube",
    async (req,res) => {

        try {

            const url =
                String(req.body.url || "")
                    .trim();

            if(!url) {

                return res.status(400).json({
                    ok:false,
                    error:"YouTube URL is required."
                });

            }

            const reference =
                await analyzeYouTube(url);

            res.json({
                ok:true,
                reference
            });

        } catch(error) {

            console.error(error);

            res.status(500).json({
                ok:false,
                error:
                    error.message ||
                    "YouTube analysis failed."
            });

        }

    }
);


app.post(
    "/api/create-project",
    async (req,res) => {

        try {

            const result =
                createProject(
                    req.body || {}
                );

            res.json({
                ok:true,
                ...result
            });

        } catch(error) {

            console.error(error);

            res.status(500).json({
                ok:false,
                error:
                    error.message ||
                    "Project creation failed."
            });

        }

    }
);


app.post(
    "/api/youtube-pack",
    async (req,res) => {

        try {

            const story =
                req.body.story || {};

            const scenes =
                req.body.scenes || [];

            const pack =
                makeYouTubePack(
                    story,
                    scenes
                );

            res.json({
                ok:true,
                pack
            });

        } catch(error) {

            res.status(500).json({
                ok:false,
                error:error.message
            });

        }

    }
);


/* =========================================================
   VIDEO RENDER
========================================================= */

app.post(
    "/api/render-video",
    upload.single("video"),
    async (req,res) => {

        let inputFile = null;
        let srtFile = null;
        let outputFile = null;

        try {

            if(!req.file) {

                return res.status(400).json({
                    ok:false,
                    error:"Video file is required."
                });

            }

            inputFile =
                req.file.path;

            const srt =
                String(req.body.srt || "")
                    .trim();

            if(!srt) {

                return res.status(400).json({
                    ok:false,
                    error:"SRT subtitle data is required."
                });

            }

            const ffmpegAvailable =
                await commandExists("ffmpeg");

            if(!ffmpegAvailable) {

                return res.status(500).json({
                    ok:false,
                    error:
                        "FFmpeg is not installed on the server."
                });

            }

            const id =
                crypto
                    .randomBytes(8)
                    .toString("hex");

            srtFile =
                path.join(
                    TEMP_DIR,
                    `${id}.srt`
                );

            const safeTitle =
                safeName(
                    req.body.title ||
                    "aung-ai-story"
                );

            outputFile =
                path.join(
                    OUTPUT_DIR,
                    `${safeTitle}-${id}.mp4`
                );

            fs.writeFileSync(
                srtFile,
                srt,
                "utf8"
            );

            /*
              FFmpeg subtitles filter requires
              escaping Windows paths.
            */

            const subtitlePath =
                srtFile
                    .replace(/\\/g,"/")
                    .replace(/:/g,"\\:");

            await runCommand(
                "ffmpeg",
                [
                    "-y",
                    "-i",
                    inputFile,

                    "-vf",
                    `subtitles='${subtitlePath}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=35'`,

                    "-c:a",
                    "copy",

                    "-c:v",
                    "libx264",

                    "-preset",
                    "veryfast",

                    "-crf",
                    "20",

                    outputFile
                ]
            );

            const filename =
                path.basename(outputFile);

            res.json({
                ok:true,
                filename,
                downloadUrl:
                    `/api/download/${encodeURIComponent(filename)}`
            });

        } catch(error) {

            console.error(
                "Render error:",
                error
            );

            res.status(500).json({
                ok:false,
                error:
                    error.message ||
                    "Video rendering failed."
            });

        } finally {

            if(inputFile) {

                try {
                    fs.unlinkSync(inputFile);
                } catch {}

            }

            if(srtFile) {

                try {
                    fs.unlinkSync(srtFile);
                } catch {}

            }

        }

    }
);


app.get(
    "/api/download/:filename",
    (req,res) => {

        const filename =
            path.basename(
                req.params.filename
            );

        const file =
            path.join(
                OUTPUT_DIR,
                filename
            );

        if(!fs.existsSync(file)) {

            return res.status(404).send(
                "File not found."
            );

        }

        res.download(file);

    }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/api/health",
    async (req,res) => {

        const ytDlp =
            await commandExists("yt-dlp");

        const ffmpeg =
            await commandExists("ffmpeg");

        res.json({

            ok:true,

            app:
                "AUNG AI STORY VIDEO PRO V9",

            ytDlp,
            ffmpeg,

            node:
                process.version

        });

    }
);


/* =========================================================
   FALLBACK
========================================================= */

app.get("*", (req,res) => {

    res.sendFile(
        path.join(
            ROOT,
            "index.html"
        )
    );

});


app.listen(
    PORT,
    () => {

        console.log(
`
=================================================

 AUNG AI STORY VIDEO PRO V9

 Server:
 http://localhost:${PORT}

 Features:
 YouTube Analysis
 Original Story
 Scene Generator
 Flow/Veo Prompts
 SRT Subtitle
 FFmpeg Render
 YouTube Pack

=================================================
`
        );

    }
);
