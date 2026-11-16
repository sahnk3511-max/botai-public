require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');

const required = ['DISCORD_TOKEN', 'DISCORD_APPLICATION_ID', 'ANTHROPIC_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const conversations = new Map();
const MAX_HISTORY = 12;
const MAX_DISCORD_MESSAGE = 1900;

const commands = [
  new SlashCommandBuilder().setName('اسأل').setDescription('اسأل المساعد الذكي أي سؤال')
    .addStringOption((o) => o.setName('سؤالك').setDescription('وش ودك تعرف؟').setRequired(true).setMaxLength(2000)),
  new SlashCommandBuilder().setName('اقترح').setDescription('عطني اقتراحات مفيدة لفكرتك أو مشكلتك')
    .addStringOption((o) => o.setName('الموضوع').setDescription('وش تبي اقتراحات عنه؟').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('أفكار_فيديو').setDescription('اقترح أفكار وسيناريوهات لمقاطع فيديو')
    .addStringOption((o) => o.setName('الموضوع').setDescription('موضوع الفيديو أو نوعه').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('مسح_المحادثة').setDescription('امسح سياق محادثتك مع البوت في هذي القناة'),
].map((c) => c.toJSON());

const systemPrompt = `أنت مساعد ذكي وودود في ديسكورد. تكلم باللهجة السعودية الطبيعية وبأسلوب واضح وخفيف، وخلك محترم ومفيد. جاوب مباشرة، وإذا احتجت معلومة ناقصة اسأل سؤالًا محددًا. قدّم خطوات عملية واقتراحات مناسبة بدل الكلام العام. لا تدّعي أنك نفذت إجراءً ما نفذته فعلًا. إذا طلب المستخدم إنشاء فيديو، وضّح أنك تقدر تساعده بفكرة وسيناريو وبرومبت، لكن إنشاء ملف فيديو فعلي يحتاج خدمة توليد فيديو خارجية مو مربوطة حاليًا.`;

async function askClaude(prompt, history = []) {
  const response = await anthropic.messages.create({
    model, max_tokens: 1200, system: systemPrompt,
    messages: [...history, { role: 'user', content: prompt }],
  });
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || 'ما قدرت أطلع رد هالمرة.';
}

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const key = `${interaction.guildId || 'dm'}:${interaction.channelId}:${interaction.user.id}`;
  if (interaction.commandName === 'مسح_المحادثة') {
    conversations.delete(key);
    await interaction.reply({ content: 'تم، مسحت سياق محادثتنا بهالقناة.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const topic = interaction.options.getString('الموضوع');
    const question = interaction.options.getString('سؤالك');
    const prompt = interaction.commandName === 'اقترح'
      ? `عطني 5 اقتراحات عملية ومختلفة عن الموضوع التالي، واشرح كل اقتراح باختصار: ${topic}`
      : interaction.commandName === 'أفكار_فيديو'
        ? `اقترح 3 أفكار فيديو عن الموضوع التالي. لكل فكرة اكتب عنوانًا جذابًا، ملخصًا، وسيناريو قصيرًا أو برومبت مناسبًا لأداة توليد فيديو: ${topic}`
        : question;
    const history = interaction.commandName === 'اسأل' ? (conversations.get(key) || []) : [];
    const answer = await askClaude(prompt, history);
    if (interaction.commandName === 'اسأل') {
      conversations.set(key, [...history, { role: 'user', content: prompt }, { role: 'assistant', content: answer }].slice(-MAX_HISTORY));
    }
    const chunks = answer.match(new RegExp(`[\\s\\S]{1,${MAX_DISCORD_MESSAGE}}`, 'g')) || ['ما قدرت أطلع رد هالمرة.'];
    await interaction.editReply(chunks[0]);
    for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, ephemeral: true });
  } catch (error) {
    console.error('Request failed:', error.message);
    await interaction.editReply('صار خطأ وأنا أجهز الرد. تأكد من إعداد مفاتيح Claude وديسكورد، وجرب مرة ثانية.').catch(() => {});
  }
});

async function start() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID);
  await rest.put(route, { body: commands });
  console.log('Discord commands registered.');
  await client.login(process.env.DISCORD_TOKEN);
}
start().catch((error) => { console.error('Bot failed to start:', error.message); process.exit(1); });
