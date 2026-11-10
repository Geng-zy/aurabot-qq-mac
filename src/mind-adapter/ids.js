// QQ 的窗口和人在心智里的 id：都带平台前缀，以后接别的平台也不会撞。
/** 'private:123' → 'qq:private:123' */
export const windowOf = (chatId) => 'qq:' + String(chatId || '')
/** '123' → 'qq:123' */
export const personOf = (userId) => 'qq:' + String(userId || '')
