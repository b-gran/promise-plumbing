const R = require('ramda')
const L = require('./lib')
const assert = require('assert')

// Given a function f that may or may not return a Promise, returns a Promise-returning
// function which returns a Promise that resolves to the return value of f
const wrap = R.compose(
  R.tryCatch(R.__, L.reject),
  R.converge(R.compose, [ R.always(L.resolve), R.identity ])
)
module.exports.wrap = wrap

// A Promise that is fulfilled after some number of milliseconds.
const delay = L.preconditions(
  L.pc(R.is(Number), 'the duration must be a number')
)(
  duration => new Promise(resolve => setTimeout(
    () => resolve(),
    R.is(Number, duration) ? Math.max(duration, 0) : 0
  ))
)
module.exports.delay = delay

// Passes a MaybePromise to a list of branching functions and resolves
// to the list of branch results. The branching functions can be Promise-returning
// or synchronous, and the value can either be a Promise or any other value.
const branch = (...branches) => valueOrPromise => Promise.resolve(valueOrPromise)
  .then(fulfilment => Promise.all(R.map(
    L.callWith(fulfilment),
    branches
  )))
module.exports.branch = branch

// Does an operation while a test returns true. The test and operation can be
// asynchronous operations. If either function rejects, exits immediately.
const whilst = (test, operation) => {
  const $test = wrap(test)
  const $operation = wrap(operation)

  return new Promise((resolve, reject) => {
    let result = []
    const iterator = operationGenerator()
    iterator.next()

    function * operationGenerator () {
      try {
        while (yield awaitPromise($test(result))) {
          result = [ ...result, yield awaitPromise($operation(result)) ]
        }
      } catch (err) {
        return reject(err)
      }

      return resolve(result)
    }

    function awaitPromise (promise) {
      promise.then(bindOwn('next', iterator)).catch(bindOwn('throw', iterator))
    }
  })
}

module.exports.whilst = whilst

// Does an operation while a test returns true. The test and operation can be
// asynchronous operations. If either function rejects, exits immediately.
// This function always performs the operation at least once --
// just like the "do while" control structure.
const doWhilst = (operation, test) => whilst(
  results => R.isEmpty(results) || test(results),
  operation
)
module.exports.doWhilst = doWhilst

// Asynchronous version of compose with arguments reversed.
// Arguments to the returned function can be Promises -- they will
// be resolved in a non-deterministic order before being passed to
// the input functions.
const pipe = (...functions) => (...args) => Promise
  .all(R.map(L.resolve, args))
  .then(resolvedArguments => R.reduce(
    (promise, step) => promise.then(step),
    wrap(R.head(functions))(...resolvedArguments),
    R.tail(functions)
  ))
module.exports.pipe = pipe

const _failure = L.symbolFallback('failure')
const _isHeadFailure = R.compose(R.equals(_failure), R.head)

// Retry an operation some number of times before reporting failure.
// An operation "fails" if either
//   1) the operation is synchronous and it throws
//   2) the operation is a Promise and it is rejected
const retry = L.preconditions(
  L.pc(R.propSatisfies(R.is(Number), 'times'), 'times must be a number')
)(
  ({ times, interval }, task) => {
    const backoff = interval ?
      // If an interval is provided, do the operation instantly on
      // the 0th try and delay for every other try.
      R.ifElse(
        R.equals(0),
        R.always(wrap),
        nthTry => f => () => delay(interval(nthTry)).then(f)
      ) :
      // If no interval is provided, never delay.
      R.always(wrap)

    return doWhilst(
      // Do the task and always have a fulfilment tuple of
      //    [ maybeFailed, result ]
      // where maybeFailed is the failure symbol if the operation failed.
      // This way, the task can return an Error or a falsey or nil value.
      x => backoff(R.length(x))(task)()
        .then(result => [ null, result ])
        .catch(err => [ _failure, err ]),

      // Continue while the latest operation failed and we
      // haven't done it "times" times
      R.allPass([
        R.compose(_isHeadFailure, R.last),
        R.compose(R.gt(times), R.length)
      ])
    ).then(R.compose(
      R.ifElse(_isHeadFailure, R.compose(L.reject, R.last), R.last),
      R.last
    ))
  }
)
module.exports.retry = retry

// A helper function that binds a function property of an object to the object.
const bindOwn = R.curry(
  L.preconditions(
    L.pc(
      R.compose(L.isStringRepresentable, R.nthArg(0)),
      'property must be a string, number, or Symbol'
    ),
    L.pc(R.compose(L.isDefined, R.nthArg(1)), 'the object must be non-nil'),
    L.pc(
      R.converge(
        R.call,
        [ R.compose(R.prop, R.nthArg(0)), R.nthArg(1) ]
      ),
      'the property must be a function'
    )
  )((property, object) => object[property].bind(object))
)
module.exports.bindOwn = bindOwn