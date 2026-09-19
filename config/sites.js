'use strict'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/**
 * 截图目标清单。Screenshot targets.
 * 想改站点：直接改本文件，或复制为 config/sites.local.js（已被 git 忽略）后修改。
 * To customize: edit this file, or copy it to config/sites.local.js (git-ignored).
 *
 * 字段说明 / Fields:
 *   key           唯一标识，用于文件名（必填）/ unique id used in filenames (required)
 *   name          展示名称 / human readable name
 *   url           要截图的地址（必填，带协议）/ target url (required, with protocol)
 *   viewport      { width, height } 视口大小 / viewport size
 *   userAgent     可选，模拟移动端 UA / optional UA override
 *   fullPage      可选，是否截整页（默认跟随全局配置）/ optional full page override
 *   waitForSelector 可选，等待某个选择器出现再截图 / optional selector to wait for
 */
module.exports = [
  {
    key: 'xiaoyuedu-pc',
    name: '校鱼 PC',
    url: 'https://www.xiaoyuedu.com',
    viewport: { width: 1600, height: 900 }
  },
  {
    key: 'xiaoyuedu-mobile',
    name: '校鱼 移动端',
    url: 'https://m.xiaoyuedu.com',
    viewport: { width: 414, height: 736 },
    userAgent: MOBILE_UA
  },
  {
    key: 'jiemodui-pc',
    name: '芥末堆 PC',
    url: 'https://www.jiemodui.com',
    viewport: { width: 1600, height: 900 }
  },
  {
    key: 'jiemodui-mobile',
    name: '芥末堆 移动端',
    url: 'https://www.jiemodui.com',
    viewport: { width: 414, height: 736 },
    userAgent: MOBILE_UA
  }
]

module.exports.MOBILE_UA = MOBILE_UA
