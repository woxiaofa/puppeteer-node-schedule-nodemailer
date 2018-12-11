const puppeteer = require('puppeteer')
const nodemailer = require('nodemailer')
const schedule = require('node-schedule')
// 延迟配置
var rule = new schedule.RecurrenceRule()
rule.dayOfWeek = [0, 1, 2, 3, 4, 5, 6]
rule.hour = 18
rule.minute = 22
//rule.second = 10  //测试用10秒循环
console.log('时间到开始!')
var j = schedule.scheduleJob(rule, function() {
  //  截图功能开始
  console.log('开始执行任务!')
  ;(async () => {
    console.log('异步开始')
    const browser = await puppeteer.launch({
      //安装Chromium失败，可以用chrome executablePath: '/usr/bin/google-chrome',
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox']
    })
    console.log('准备访问www.xiaoyuedu.com')
    const page = await browser.newPage()
    await page.setViewport({
      width: 1600,
      height: 900
    })
    await page.goto('https://www.xiaoyuedu.com')
    console.log('准备截图校鱼1600')
    await page.screenshot({
      path: 'xiaoyued1600.png',
      type: 'png',
      fullPage: true
    })
    console.log('校鱼1600截图完成，下一个')
    await page.waitFor(1000)
    console.log('准备访问m.xiaoyuedu.com')
    const page1 = await browser.newPage()
    await page1.setViewport({
      width: 414,
      height: 736
    })
    await page1.goto('https://m.xiaoyuedu.com')
    console.log('准备截图校鱼414')
    await page1.screenshot({
      path: 'xiaoyued414.png',
      type: 'png',
      fullPage: true
    })
    console.log('校鱼414截图完成，下一个')
    await page1.waitFor(1000)

    console.log('准备访问PC版jiemodui.com')
    const pagej = await browser.newPage()
    await pagej.setViewport({
      width: 1600,
      height: 900
    })
    await pagej.goto('https://www.jiemodui.com')
    console.log('准备截图芥末堆1600')
    await pagej.screenshot({
      path: 'jiemodui1600.png',
      type: 'png',
      fullPage: true
    })
    console.log('校鱼1600截图完成，下一个')
    await pagej.waitFor(1000)
    console.log('准备访问移动版jiemodui.com')
    const pagejm = await browser.newPage()
    await pagejm.setViewport({
      width: 414,
      height: 736
    })
    await pagejm.goto('https://www.jiemodui.com')
    console.log('准备截图芥末堆414')
    await pagejm.screenshot({
      path: 'jiemodui414.png',
      type: 'png',
      fullPage: true
    })
    console.log('芥末堆414截图完成，等明天')
    await pagejm.waitFor(1000)
    browser.close()
  })()
    // 截图功能结束

    .then(() => console.log('截图且保存到文件夹成功！'))
    //执行
    .then(img => {
      //发邮件配置
      var transporter = nodemailer.createTransport({
        host: 'smtp.exmail.qq.com',
        secure: true,
        port: 465,
        auth: {
          user: '这里填写你的发件邮箱', //如 114205291@qq.com
          pass: '这里你的发件邮箱密码'
        },
        debug: true // include SMTP traffic in the logs
      })
      // 邮件标题内容
      var message = {
        from: '自截图 114205291@qq.com',
        to: '114205291@qq.com,wxf_mm@foxmail.com',
        //cc: '114205291@qq.com',
        subject: '芥末堆和校鱼网站截图pc版本和移动版',
        html:
          '网站截图：<img src="cid:testJmd"/><img src="cid:testjmd"/><img src="cid:xiaoyu"/><img src="cid:mxiaoyu"/>',
        attachments: [
          {
            filename: 'jiemodui1600',
            path: __dirname + '/jiemodui1600.png',
            cid: 'testJmd'
          },
          {
            filename: 'jiemodui414',
            path: __dirname + '/jiemodui414.png',
            cid: 'testjmd'
          },
          {
            filename: 'xiaoyued1600',
            path: __dirname + '/xiaoyued1600.png',
            cid: 'xiaoyu'
          },
          {
            filename: 'xiaoyued414',
            path: __dirname + '/xiaoyued414.png',
            cid: 'mxiaoyu'
          }
        ]
      }
      transporter.sendMail(message, (error, info) => {
        if (error) {
          console.log('错误')
          console.log(error.message)
          return
        }
        console.log('截图邮件发送成功!')
        console.log('服务器响应 "%s"', info.response)
        transporter.close()
      })
    })
    .catch(err => {
      throw err
    })
})
