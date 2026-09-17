/** First-run copy for the model channel Desktop ships as its default route. */

export const zh = {
  title: '填写 zhuzi 渠道密钥',
  description: 'DHDesk 默认使用 zhuzi 渠道的模型。填入该渠道的 API Key 后即可开始对话。',
  keyLabel: 'zhuzi API Key',
  keyPlaceholder: '粘贴你的 API Key',
  hint: '密钥保存在本机凭据文件中，不写入 profile 配置，也不随仓库分发。',
  save: '保存并继续',
  saving: '正在保存…',
  skip: '稍后再说',
  saveFailed: '密钥未能保存。',
} as const

/** English first-run copy for the shipped route's credential step. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Add your zhuzi channel key',
  description: 'DHDesk ships zhuzi as its default model channel. Add this channel\'s API key to start chatting.',
  keyLabel: 'zhuzi API Key',
  keyPlaceholder: 'Paste your API key',
  hint: 'The key is stored in this machine\'s credential file. It never enters the profile configuration or this repository.',
  save: 'Save and continue',
  saving: 'Saving…',
  skip: 'Not now',
  saveFailed: 'The key could not be saved.',
}

/** Copy keys of the shipped route's first-run step. */
export type DesktopChannelOnboardingLocaleKey = keyof typeof zh
