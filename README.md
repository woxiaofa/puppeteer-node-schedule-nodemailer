# puppeteer-node-schedule-nodemailer
用node-schedule每天执行puppeteer截图nodemailer发邮件给需要的人

之前的https://github.com/woxiaofa/node-schedule-pageres-nodemailer
截图vue做的网站是空白所以改用了PUPPETEER

### 感谢
klren0312的提醒

### 主要作用

1、记录网站改版记录留存

2、运营广告人员需要的网站截图记录留存






### 
```

发邮件用的包 网址： https://nodemailer.com/about/
 
定时使用的包 网址： https://github.com/node-schedule/node-schedule
 
截图用的包 网址： https://github.com/GoogleChrome/puppeteer


```

### 使用方法

```

1.需要node环境（网上很多教程）
2.下载package.json和index.js到一个文件夹
3.在这个目录下npm install 然后运行 node pup.js 就可以执行了
```
### 常见问题
```
1.Chromium下载不下来，可以用cnpm，或者自己下载到本地用路径指向他网上好多介绍
2.在centos上Chromium用cnpm也安装不成功，改用chrome
```
### 本地路径设置方法，和换浏览器核心的修改方法

```
//pup.js中加一句路径的引导

```

const browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome' //自己的浏览器的路径
      })
      
```

//ps 自己这次尝试用了nohup node pup.js & 这种方法来后台执行命令，这么简单的东西百度就可以了，之前研究了好久 

