// Guarantee TS namespace.
if (!window.TS) {
  window.TS = {};
}

// TS.SignalViewer class.
!function($,TS) {

  // Creates a new SignalViewer object with a hash of options. Possible
  // arguments are:
  // - data   : A path to a csv file containing the data or a json hash containing data.
  // - d3     : The d3 instance to use. Default is windows.d3
  // - colors : An array of colors. Default is ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"]
  TS.SignalViewer = function(args) {
    this.args = args;
    this.d3 = this.args.d3 || window.d3;

    this.colors = this.args.colors || ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"];
    this.reverseColors = this.colors.slice().reverse();
    this.activeColorSet = d3.scale.quantile().range(this.reverseColors);

    this.totalRows = 0; //This is the total data rows loaded.  Used for status bar.

    // Keep Selected Signals Button
    this.d3.select('#btnKeep').on('click', $.proxy(this.keepSelected, this))
    // Reset Chart Button
    this.d3.select('#btnReset').on('click', $.proxy(this.resetChart, this));

    // Init parrallel coordinates chart
    this.parcoords = this.d3.parcoords()('#chart')
                            .alpha(0.4)
                            .mode('queue') // progressive rendering
                            .rate(30)
                            .composite('darken');

    // update grid on brush
    this.parcoords.on("brush", $.proxy(_parcoordsBrushHandler, this));

    // Init slickgrid data view
    this.dataView = new Slick.Data.DataView();

    // wire up model events to drive the grid
    this.dataView.onRowCountChanged.subscribe($.proxy(_rowCountChangedHandler, this));
    this.dataView.onRowsChanged.subscribe($.proxy(_rowsChangedHandler, this));

    // Create the grid itself
    this.grid = new Slick.Grid('#grid', this.dataView, {}, {
                                enableCellNavigation: true,
                                enableColumnReorder: false,
                                multiColumnSort: false
                              });

    // Create a pager scroll
    this.pager = new Slick.Controls.Pager(this.dataView, this.grid, $('#pager'));

    // click header to sort grid column
    this.grid.onSort.subscribe($.proxy(_sortSignals, this));

    // highlight row in chart
    this.grid.onMouseEnter.subscribe($.proxy(_gridMouseEnterHandler, this));
    this.grid.onClick.subscribe($.proxy(_gridClickHandler, this));
    this.grid.onMouseLeave.subscribe($.proxy(_gridMouseLeaveHandler, this));

    // Populate the viewer
    this.loadData(this.args.data);

    return this;
  };

  TS.SignalViewer.prototype = {};

  // This loads the given data. If the data is a string it will attempted to be loaded as a url.
  // If it is a hash, it will load the data directly.
  TS.SignalViewer.prototype.loadData = function(data) {
    if (typeof data == 'object') {
      // Load directly
      $.proxy(_loadData, this, data)();
    } else {
      // Assume it is a url
      this.d3.csv(data, $.proxy(_loadData, this));
    }
  };

  // Feedback on selection
  TS.SignalViewer.prototype.displaySelectionStats = function(n) {
    if (this.totalRows === 0) return;

    this.d3.select("#data-count").text(this.totalRows);
    this.d3.select("#selected-count").text(n);
    this.d3.select("#selected-bar").style("width", (100 * n / this.totalRows) + "%");
    opacity = d3.min([2 / Math.pow(n, 0.15), 1]);
    $('.parcoords canvas').css('opacity', opacity);
  }

  // update color and font weight of chart based on axis selection
  // modified from here: https://syntagmatic.github.io/parallel-coordinates/
  TS.SignalViewer.prototype.updateColors = function(dimension) {
    dimension = dimension || $(e.target).text();

    // change the fonts to bold
    this.parcoords.svg.selectAll(".dimension")
                      .style("font-weight", "normal")
                      .filter(function (d) { return d == dimension; })
                      .style("font-weight", "bold");

    // change color of lines
    // set domain of color scale
    var values = this.parcoords.data().map(function (d) { return parseFloat(d[dimension]) });
    var min = Math.sqrt(Math.abs(this.d3.min(values)));
    var max = Math.sqrt(Math.abs(this.d3.max(values)));
    if (min > max) {
      this.activeColorSet.domain([min, max])
                         .range(this.colors);
    }
    else {
      this.activeColorSet.domain([min, max])
                         .range(this.reverseColors);
    }
    // change colors for each line
    this.parcoords.color($.proxy(_updateColors, this, dimension)).render();
  };

  // Narrow the total result set to the current selected signals
  TS.SignalViewer.prototype.keepSelected = function(e) {
    var selectedSignals = this.parcoords.brushed();
    this.parcoords.brushReset();
    this.parcoords.data().slice(this.data.length);
    this.loadData(selectedSignals);
    // Autoscale axes
    // this.parcoords.autoscale().render();
  }

  // Resets the signal viewer chart colors and signals.
  TS.SignalViewer.prototype.resetChart = function(e) {
    this.parcoords.brushReset();
    this.loadData(this.args.data);
  }

  // Private functions

  // For some reason, null is always the first parameter when being loaded as a csv.
  // I am sure there is a good reason but I cannot figure it out, so I disregard it.
  function _loadData(_,data) {
    this.data = _ || data;
    this.pinnedSignals = [];
    this.parcoords.unhighlight();
    $('.slick-row').removeClass('pinned');

    // slickgrid needs each data element to have an id
    $.each(this.data, function(d, i) { d.id = d.id || i; });

    this.totalRows = this.data.length;

    this.parcoords.data(this.data)
                  .smoothness(0.2)
                  .showControlPoints(false)
                  .hideAxis(['id'])
                  .render()
                  .brushMode('1D-axes-multi')
                  .reorderable();

    // click label to activate coloring
    this.parcoords.svg.selectAll('.dimension')
                      .on('click', $.proxy(this.updateColors, this))
                      .selectAll('.label');

    this.updateColors('Fc (MHz)');

    // Setup columns to be all but id, Day of Week, and Hour of Day
    var columns = this.d3.keys(this.data[0]).filter(function(key) { return ['id','Day of Week','Hour of Day'].indexOf(key) == -1 })
                                            .map(function(key) { return { id: key, name: key, field: key, sortable: true } });

    this.grid.setColumns(columns);

    // fill grid with data
    $.proxy(_updateGrid, this, this.data)();

    // Display stats
    this.displaySelectionStats(this.data.length);
  };

  function _updateGrid(data) {
    this.dataView.beginUpdate();
    this.dataView.setItems(data);
    this.dataView.endUpdate();
  };

  function _sortSignals(e, args) {
    var sortdir = args.sortAsc ? 1 : -1;
    var sortcol = args.sortCol.field;
    if ($.browser.msie && $.browser.version <= 8) {
      this.dataView.fastSort(sortcol, args.sortAsc);
    } else {
      this.dataView.sort(function(a, b) {
        var x = a[sortcol], y = b[sortcol];
        return (x == y ? 0 : (x > y ? 1 : -1));
      }, args.sortAsc);
    }
  }

  function _rowCountChangedHandler() {
    this.grid.updateRowCount();
    this.grid.render();
  }

  function _rowsChangedHandler(e, args) {
    this.grid.invalidateRows(args.rows);
    $('.slick-row').removeClass('pinned');
    this.parcoords.unhighlight();
    this.pinnedSignals = [];
    this.grid.render();
  }

  function _gridMouseEnterHandler(e, args) {
    var i = this.grid.getCellFromEvent(e).row;
    var d = this.parcoords.brushed() || this.data;
    this.parcoords.highlight([d[i]]);
  }

  function _gridClickHandler(e, args) {
    var i = this.grid.getCellFromEvent(e).row;
    var d = this.parcoords.brushed() || this.data;
    var s = $.grep(this.pinnedSignals,function(s) { return s.id == d[i].id; });
    if (s.length == 0) {
      this.pinnedSignals.push(d[i]);
      $('.slick-row').eq(i).addClass('pinned');
    } else {
      this.pinnedSignals.splice(this.pinnedSignals.indexOf(s[0]),1);
      $('.slick-row').eq(i).removeClass('pinned');
    }
    this.parcoords.highlight(this.pinnedSignals);
  }

  function _gridMouseLeaveHandler(e, args) {
    this.parcoords.unhighlight();
    this.parcoords.highlight(this.pinnedSignals);
  }

  function _parcoordsBrushHandler(d) {
    this.displaySelectionStats(d.length);
    $.proxy(_updateGrid, this, d)();
  }

  function _updateColors(dimension, d) {
    return this.activeColorSet(Math.sqrt(Math.abs(d[dimension])));
  }
}(window.jQuery,window.TS);