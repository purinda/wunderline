#!/usr/bin/env node

var app = require('commander')
var async = require('async')
var stdin = require('get-stdin')
var trunc = require('lodash.trunc')
var moment = require('moment')
var opn = require('opn')
var api = require('./lib/api')
var getInbox = require('./lib/get-inbox')
var Configstore = require('configstore')
var conf = new Configstore('wunderline', {platform: 'web'})
var auth = require('./lib/auth')

function openTask (task) {
  var web = 'https://www.wunderlist.com/#/tasks/' + task.id
  var mac = 'wunderlist://tasks/' + task.id
  if (conf.get('platform') === 'mac') return opn(mac)
  opn(web)
}

function openList (list) {
  var web = 'https://www.wunderlist.com/#/lists/' + list.id
  var mac = 'wunderlist://lists/' + list.id
  if (conf.get('platform') === 'mac') return opn(mac)
  opn(web)
}

app
  .description('Add a task to your inbox')
  .usage('[task]')
  .option('-l, --list [name]', 'Specify a list other than your inbox')
  .option('--today', 'Set the due date to today')
  .option('--tomorrow', 'Set the due date to tomorrow')
  .option('--due [date]', 'Set a specific due date')
  .option('--note [note]', 'Attach a note to the new task')
  .option('-o, --open', 'Open Wunderlist on completion')
  .option('-s, --stdin', 'Create tasks from stdin')
  .parse(process.argv)

function truncateTitle (title) {
  return trunc(title.trim(), 254)
}

function getListId (cb) {
  if (!app.list) {
    return getInbox(function (inbox) {
      cb(inbox.id)
    })
  }

  var list = {
    title: app.list.trim()
  }

  api('/lists', function (err, res, body) {
    if (err) process.exit(1)

    var existing = body.filter(function (item) {
      return item.title.toLowerCase().trim() === list.title.toLowerCase()
    })
    if (existing.length > 0) {
      return cb(existing[0].id)
    }
    api.post({url: '/lists', body: list}, function (err, res, body) {
      if (err) process.exit(1)

      cb(body.id)
    })
  })
}

function main () {
  var due_date

  if (app.today) {
    due_date = moment().format('YYYY-MM-DD')
  }

  if (app.tomorrow) {
    due_date = moment().add(1, 'day').format('YYYY-MM-DD')
  }

  if (app.due && /\d{4}\-\d{2}\-\d{2}/.test(app.due)) {
    due_date = app.due
  }

  if (typeof app.stdin === 'undefined') {
    var title = app.args.join(' ')

    if (!title) {
      process.exit(1)
    }

    async.waterfall([
      function (cb) {
        getListId(function (inbox_id) {
          cb(null, inbox_id)
        })
      },
      function (inbox_id, cb) {
        cb(null, {
          title: truncateTitle(title),
          list_id: inbox_id,
          due_date: due_date
        })
      },
      function (task, cb) {
        api.post({url: '/tasks', body: task}, function (err, res, body) {
          if (err || body.error) {
            console.error(JSON.stringify(err || body.error, null, 2))
            process.exit(1)
          }

          cb(null, body)
        })
      },
      function (task, cb) {
        if (app.note) {
          api.post({url: '/notes', body: { task_id: task.id, content: app.note }}, function (err, res, body) {
            if (err || body.error) {
              console.error(JSON.stringify(err || body.error, null, 2))
              process.exit(1)
            }

            cb(null, task)
          })
        } else {
          cb(null, task)
        }
      }
    ], function (err, res) {
      if (err) {
        process.exit(1)
      }
      if (app.open) {
        openTask(res)
      }
      process.exit()
    })
  }

  if (app.stdin === true) {
    async.waterfall([
      function (cb) {
        stdin().then(data => {
          var sep = data.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
          var lines = data.trim().split(sep)
          cb(null, lines)
        })
      },
      function (lines, cb) {
        getListId(function (list_id) {
          cb(null, list_id, lines)
        })
      },
      function (list_id, lines, cb) {
        var tasks = lines
          .filter(function (line) {
            return line.trim().length > 0
          })
          .map(function (line) {
            return {
              title: truncateTitle(line),
              due_date: due_date,
              list_id: list_id
            }
          })
        cb(null, tasks)
      }
    ], function (err, tasks) {
      if (err) {
        process.exit(1)
      }

      async.each(tasks, function (task, finished) {
        api.post({url: '/tasks', body: task}, function (err, res, body) {
          if (err || body.error) {
            console.error(JSON.stringify(err || body.error, null, 2))
            process.exit(1)
          }
          process.stderr.write('.')
          finished()
        })
      }, function () {
        if (app.open && tasks.length > 0) {
          openList({id: tasks[0].list_id})
        }

        process.exit()
      })
    })
  }
}

auth(main)
