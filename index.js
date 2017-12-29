#!/usr/bin/env node
'use strict'

process.title = require('./package').name

var os = require('os')
var fs = require('fs')
var path = require('path')
var download = require('download-to-file')
var xml2js = require('xml2js')
var nearest = require('nearest-date')
var diffy = require('diffy')({fullscreen: true})
var input = require('diffy/input')()
var trim = require('diffy/trim')
var Grid = require('virtual-grid')
var scrollable = require('scrollable-string')
var Menu = require('menu-string')
var wrap = require('wrap-ansi')
var pad = require('fixed-width-string')
var chalk = require('chalk')
var argv = require('minimist')(process.argv.slice(2))

var URL = 'https://events.ccc.de/congress/2017/Fahrplan/schedule.xml'
var CACHE = path.join(os.homedir(), '.34c3', 'schedule.xml')
var activeCol = 0
var grid, talk

if (argv.help || argv.h) help()
else if (argv.version || argv.v) version()
else if (argv.update || argv.u) update()
else run()

function help () {
  console.log('Usage: 34c3 [options]')
  console.log()
  console.log('Options:')
  console.log('  --help, -h     Show this help')
  console.log('  --version, -v  Show version')
  console.log('  --update, -u   Update schedule with new changes')
}

function version () {
  console.log(require('./package').version)
}

function update () {
  console.log('Downloading schedule to %s...', CACHE)
  download(URL, CACHE, function (err) {
    if (err) throw err
    run()
  })
}

function run () {
  load(function (err, schedule) {
    if (err) throw err
    initUI(schedule)
    updateTopBar()
  })
}

function load (cb) {
  fs.stat(CACHE, function (err) {
    var filepath = err ? path.join(__dirname, 'schedule.xml') : CACHE
    console.log('Schedule cache:', filepath)
    fs.readFile(filepath, function (err, xml) {
      if (err) return cb(err)
      // Unfortunately error handling is very bad in xml2js, so it will throw
      // if the xml is malformed instead of passing on the error to the
      // callback. Bug report:
      // https://github.com/Leonidas-from-XIV/node-xml2js/issues/408
      try {
        xml2js.parseString(xml, function (err, result) {
          if (err) return cb(err)
          cb(null, result.schedule)
        })
      } catch (e) {
        console.error('Could not parse conference schedule - malformed XML!')
        console.error('Run "34c3 --update" to re-download the schedule')
        process.exit(1)
      }
    })
  })
}

function initUI (schedule) {
  // setup virtual grid
  grid = new Grid([
    [{height: 2, wrap: false, padding: [0, 1, 0, 0]}, {height: 2, wrap: false, padding: [0, 0, 0, 1]}],
    [{padding: [0, 1, 0, 0], wrap: false}, {padding: [0, 0, 0, 1], wrap: false}]
  ])

  grid.on('update', function () {
    diffy.render()
  })

  // setup screen
  diffy.on('resize', function () {
    grid.resize(diffy.width, diffy.height)
  })

  diffy.render(function () {
    return grid.toString()
  })

  // generate menu
  var menu = initMenu(schedule)

  menu.on('update', function () {
    grid.update(1, 0, menu.toString())
  })

  menu.select(nearest(menu.items.map(function (item) {
    return item.date
  })))

  // listen for keybord input
  input.on('keypress', function (ch, key) {
    if (ch === 'k') goUp()
    if (ch === 'j') goDown()
    if (ch === 'q') process.exit()
  })
  input.on('up', goUp)
  input.on('down', goDown)

  input.on('left', function () {
    activeCol = 0
    updateTopBar()
  })

  input.on('right', function () {
    activeCol = 1
    updateTopBar()
  })

  input.on('tab', function () {
    activeCol = activeCol === 0 ? 1 : 0
    updateTopBar()
  })

  input.on('enter', function () {
    var item = menu.selected()
    talk = scrollable(renderTalk(item.event), {
      maxHeight: grid.cellAt(1, 1).height
    })
    talk.on('update', updateTalk)
    updateTalk()
  })

  function updateTalk () {
    updateTopBar()
    grid.update(1, 1, talk.toString())
  }

  function goUp () {
    if (activeCol === 0) menu.up()
    else if (talk) talk.up()
  }

  function goDown () {
    if (activeCol === 0) menu.down()
    else if (talk) talk.down()
  }
}

function initMenu (schedule) {
  var items = []

  schedule.day.forEach(function (day, index) {
    items.push({text: 'Day ' + (index + 1), separator: true})

    var events = []

    day.room.forEach(function (room, roomIndex) {
      if (!room.event) return
      room.event.forEach(function (event, index) {
        events.push({
          text: `  ${event.start}: ${event.title[0]} (${event.room}, ${event.language[0].toUpperCase()})`,
          event: event,
          date: (new Date(event.date[0])).getTime()
        })
      })
    })

    items = items.concat(events.sort(function (a, b) {
      return a.date - b.date
    }))
  })

  var maxWidth = items.reduce(function (max, item) {
    return item.text.length > max ? item.text.length : max
  }, 0)
  var height = grid.cellAt(1, 0).height

  var menu = new Menu({
    items: items,
    render: function (item, selected) {
      return selected ? chalk.inverse(pad(item.text, maxWidth)) : item.text
    },
    height: height
  })

  return menu
}

function renderTopBar (text, active) {
  return active
    ? chalk.black.bgGreen(pad(text, process.stdout.columns))
    : text
}

function updateTopBar () {
  grid.update(0, 0, renderTopBar(` 34c3 schedule - ${chalk.bold('enter:')} select, ${chalk.bold('tab:')} switch column`, activeCol === 0))
  grid.update(0, 1, renderTopBar(talk ? `Scroll: ${Math.round(talk.pct() * 100)}%` : '', activeCol === 1))
}

function renderTalk (talk) {
  var cell = grid.cellAt(1, 1)
  var width = cell.width - cell.padding[1] - cell.padding[3]

  var body = trim(`
    Room:     ${talk.room[0]}
    Start:    ${talk.start[0]}
    Duration: ${talk.duration[0]}

    ${chalk.black.bgYellow('** Title **')}
    ${talk.title[0]}
  `)

  if (talk.subtitle[0]) {
    body = trim(`
      ${body}
      ${chalk.black.bgYellow('** Subtitle **')}
      ${talk.subtitle[0]}
    `)
  }

  body = trim(`
    ${body}
    ${chalk.black.bgYellow('** Abstract **')}
    ${talk.abstract[0]}
  `)

  if (talk.description[0]) {
    body = trim(`
      ${body}
      ${chalk.black.bgYellow('** Description **')}
      ${talk.description[0]}
    `)
  }

  return wrap(body, width)
}
